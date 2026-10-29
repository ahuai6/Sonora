const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "bootstrap",
  "search",
  "charts",
  "recommend",
  "collection",
  "resolve",
  "lyrics",
  "saveLyrics",
  "download",
  "downloadAction",
  "chooseDirectory",
  "scanLibrary",
  "importMusic",
  "libraryAction",
  "tagRead",
  "tagSave",
  "tagRestore",
  "tagSearch",
  "tagArtwork",
  "tagMatchCover",
  "tagMatchLyrics",
  "saveSettings",
  "saveAccount",
  "logout",
  "accountPlaylists",
  "openLogin",
  "auth",
  "profiles",
  "saveProfiles",
  "resetProfiles",
  "testProvider",
  "openFolder",
  "exportDiagnostics",
  "windowAction",
];
const api = Object.fromEntries(
  methods.map((name) => [
    name,
    (...args) => ipcRenderer.invoke(`sonora:${name}`, ...args),
  ]),
);
api.onDownload = (fn) => {
  const listener = (_e, value) => fn(value);
  ipcRenderer.on("sonora:download", listener);
  return () => ipcRenderer.removeListener("sonora:download", listener);
};
api.onLibrary = (fn) => {
  const listener = (_event, items) => fn(items);
  ipcRenderer.on("sonora:library", listener);
  return () => ipcRenderer.removeListener("sonora:library", listener);
};
contextBridge.exposeInMainWorld("sonora", Object.freeze(api));
