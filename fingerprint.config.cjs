module.exports = {
  fileHookTransform(source, chunk) {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk === null) return chunk;
    const config = JSON.parse(chunk.toString());
    if (config.extra?.agentDemo?.fixtureId !== 'prizepicks-v1') return chunk;
    // This is embedded JavaScript identity. It cannot change native compatibility.
    config.extra.agentDemo.sourceSha = 'embedded-candidate';
    return JSON.stringify(config);
  },
};
