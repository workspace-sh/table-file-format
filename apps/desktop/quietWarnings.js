// table-ui's styles are written once for the web and native. On native,
// react-strict-dom warns for each property only the web has (whiteSpace,
// outlineStyle, position: fixed...). That is expected here, and in
// development any warning keeps a banner over the window, so those are
// dropped; every other warning still shows. Its own module, imported before
// App, because some of those styles are made as App is imported.
if (__DEV__) {
  const warn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("React Strict DOM: unsupported style")) return;
    warn(...args);
  };
}
