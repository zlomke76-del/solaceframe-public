# SolaceFrame Studio V18.1

V18.1 upgrades the video execution adapter to complete provider-returned video payloads into storage-backed artifacts.

The runtime now recognizes:

- `result.video`
- `result.videos[0]`
- `result.files[0]`
- `providerMetadata.*.video`
- `providerMetadata.*.videos[0]`
- URL, base64, data URL, Uint8Array, and ArrayBuffer delivery

This keeps the governance path truthful: successful media becomes a playable video artifact; metadata-only provider responses stay visible as metadata instead of being represented as fake video.
