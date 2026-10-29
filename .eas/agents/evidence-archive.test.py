import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('archive_admission', pathlib.Path(__file__).with_name('evidence-archive.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


class ArchiveAdmission(unittest.TestCase):
    def make(self, root, mutation=None):
        payload = b'admitted media'
        source = 'a' * 40
        evidence = {'path': 'session.mp4', 'bytes': len(payload), 'sha256': admission.sha(payload)}
        target = {'source': {'sha': source}, 'controller': {'sha': source}, 'bundle': {'candidate': source}, 'criteria': {'sha256': admission.sha(b'criteria')}}
        result = {'runId': 'run', 'attemptId': 'attempt', 'state': 'PASS', 'target': target, 'startedAt': 1000000, 'finishedAt': 1005000,
                  'evidence': {'identity': evidence, 'screenshots': [], 'recording': evidence}}
        raw = json.dumps(result).encode()
        pin = {'kind': 'ci', 'runId': 'run', 'attemptId': 'attempt', 'state': 'PASS', 'sourceSha': source, 'resultSha256': admission.sha(raw)}
        files = [('result.json', raw, 1001), ('target.json', json.dumps(target).encode(), 1001), ('criteria.md', b'criteria', 1001), ('session.mp4', payload, 1001)]
        if mutation:
            files = mutation(files)
        path = pathlib.Path(root) / 'archive.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            for name, data, timestamp in files:
                entry = tarfile.TarInfo('home/expo/workingdir/build/agent-output/public/attempt/' + name)
                entry.size = len(data)
                entry.mtime = timestamp
                if name == 'symlink.png':
                    entry.type = tarfile.SYMTYPE
                    entry.linkname = '/private/file'
                archive.addfile(entry, io.BytesIO(data))
        data = path.read_bytes()
        pin.update(archiveSha256=admission.sha(data), archiveBytes=len(data))
        return path, pin

    def test_duplicate_identical_members_are_admitted_once(self):
        with tempfile.TemporaryDirectory() as root:
            path, pin = self.make(root, lambda files: files + [files[-1]])
            out = pathlib.Path(root) / 'admitted'
            receipt = admission.extract(path, out, pin)
            self.assertEqual((out / 'session.mp4').read_bytes(), b'admitted media')
            self.assertEqual(receipt['archiveSha256'], pin['archiveSha256'])

    def test_rejects_archive_attacks_and_foreign_windows(self):
        mutations = [
            lambda files: files + [('../escape.png', b'x', 1001)],
            lambda files: files + [('symlink.png', b'', 1001)],
            lambda files: files + [('session.mp4', b'changed', 1001)],
            lambda files: [(name, data, 1 if name == 'session.mp4' else t) for name, data, t in files],
            lambda files: [(name, b'changed' if name == 'session.mp4' else data, t) for name, data, t in files],
            lambda files: [('../foreign/result.json' if name == 'result.json' else name, data, t) for name, data, t in files],
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as root:
                path, pin = self.make(root, mutate)
                with self.assertRaises((AssertionError, KeyError)):
                    admission.extract(path, pathlib.Path(root) / 'admitted', pin)
                self.assertFalse((pathlib.Path(root) / 'admitted').exists())

    def test_hash_pin_cannot_be_substituted(self):
        with tempfile.TemporaryDirectory() as root:
            path, pin = self.make(root)
            pin['archiveSha256'] = 'f' * 64
            with self.assertRaises(AssertionError):
                admission.extract(path, pathlib.Path(root) / 'admitted', pin)


if __name__ == '__main__':
    unittest.main()
