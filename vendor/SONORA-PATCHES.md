# Vendor maintenance

KuGouMusicApi is pinned to upstream v1.6.3, commit 5d6c9f7b180279c9dd08bc6f7159de52a856d587. API source and MIT license are retained.

Sonora consumes the JavaScript modules directly. The vendored package manifest omits upstream development dependencies and unused pkg/tsdown development packaging scripts, to avoid installing obsolete tools which are not used or distributed by Sonora. Build and test Sonora from its root package.json.

The LRC-GET QRC decoder is pinned to commit 2cc0e67dcfc567a122ebb953ef696783a6760d17 with its MIT license in main/vendor/lrc-get. Neither source tracks an unpinned branch automatically.
