"""Extract only hash-pinned controller evidence. No credentials or network access."""
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import sys
import tarfile
from datetime import datetime


def sha(value):
    return hashlib.sha256(value).hexdigest()


def extract(archive_path, output, pin):
    path = pathlib.Path(archive_path)
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == pin['archiveBytes'], 'unsafe archive'
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as handle:
        data = handle.read(160_000_001)
        after = os.fstat(handle.fileno())
    assert (before.st_ino, before.st_dev, before.st_mtime_ns, before.st_size) == (after.st_ino, after.st_dev, after.st_mtime_ns, after.st_size)
    assert len(data) == pin['archiveBytes'] and sha(data) == pin['archiveSha256'], 'archive hash mismatch'
    prefix = 'home/expo/workingdir/build/agent-output/' + ('qa/' if pin['kind'] == 'qa' else '') + 'public/' + pin['attemptId'] + '/'
    selected = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for index, member in enumerate(archive):
            assert index < 1000, 'archive member limit'
            name = member.name
            while name.startswith('./'):
                name = name[2:]
            assert not name.startswith('/') and '\\' not in name and '..' not in name.split('/'), 'unsafe archive path'
            assert member.isdir() or member.isfile(), 'archive links and devices are forbidden'
            if member.isdir():
                continue
            assert name.startswith(prefix), 'foreign attempt in archive'
            relative = name[len(prefix):]
            assert re.fullmatch(r'(?:(?:scores|current-player|search-back)/)?[a-z0-9-]+\.(?:json|md|png|mp4)', relative), 'unsafe evidence member'
            assert 0 < member.size <= 150_000_000
            payload = archive.extractfile(member).read(150_000_001)
            total += len(payload)
            assert total <= 320_000_000 and len(payload) == member.size
            if relative in selected:
                assert selected[relative][0] == payload, 'duplicate-different archive member'
            else:
                selected[relative] = (payload, member.mtime)
    raw = selected['result.json'][0]
    assert sha(raw) == pin['resultSha256'], 'result hash mismatch'
    result = json.loads(raw)
    assert result['runId'] == pin['runId'] and result['attemptId'] == pin['attemptId'] and result['state'] == pin['state']
    target = result['target']
    assert target['source']['sha'] == pin['sourceSha'] == target['controller']['sha'] == target['bundle']['candidate']
    start = result['startedAt'] / 1000 if isinstance(result['startedAt'], int) else datetime.fromisoformat(result['startedAt'].replace('Z', '+00:00')).timestamp()
    finish = result['finishedAt'] / 1000 if isinstance(result['finishedAt'], int) else datetime.fromisoformat(result['finishedAt'].replace('Z', '+00:00')).timestamp()
    references = []
    if pin['kind'] == 'qa':
        for lane in result['lanes']:
            assert lane['id'] in ['scores', 'current-player', 'search-back']
            references += [(lane['id'] + '/' + ref['path'], ref) for ref in [lane['identity'], *lane['screenshots'], lane['recording']]]
    else:
        evidence = result['evidence']
        references = [(ref['path'], ref) for ref in [evidence['identity'], *evidence['screenshots'], evidence['recording']]]
    for name, ref in references:
        payload, timestamp = selected[name]
        assert len(payload) == ref['bytes'] and sha(payload) == ref['sha256'], 'reference hash mismatch'
        assert start - 1 <= timestamp <= finish + 5, 'evidence outside original observation window'
    assert json.loads(selected['target.json'][0]) == target, 'target receipt mismatch'
    if pin['kind'] != 'qa':
        assert sha(selected['criteria.md'][0]) == target['criteria']['sha256']
    destination = pathlib.Path(output)
    destination.mkdir(mode=0o700)
    admitted = ['result.json', 'target.json'] + [name for name, _ in references]
    if pin['kind'] != 'qa':
        admitted.append('criteria.md')
    admitted = list(dict.fromkeys(admitted))
    for name in admitted:
        target_path = destination / name
        target_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target_path.open('xb') as handle:
            handle.write(selected[name][0])
        target_path.chmod(0o600)
    return {'archiveSha256': pin['archiveSha256'], 'resultSha256': sha(raw), 'members': len(admitted), 'runId': pin['runId'], 'attemptId': pin['attemptId']}


if __name__ == '__main__':
    try:
        registry = json.loads((pathlib.Path(__file__).parent / 'evidence-history.json').read_text())
        receipt = extract(sys.argv[2], sys.argv[3], registry[sys.argv[1]])
        print(json.dumps(receipt))
    except Exception:
        print('Historical archive admission failed.', file=sys.stderr)
        raise SystemExit(2)
