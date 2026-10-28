/* STAGING ONLY: same live SSOT and normal auth, reject every business mutation. */
(function(root) {
  root.__UPAH_READ_ONLY__ = true;
  const nativeFetch = root.fetch.bind(root);
  root.upahPreviewReadFetch = function(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, root.location.href);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if ((url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) && !['GET', 'HEAD'].includes(method)) {
      return Promise.reject(new Error('Preview baca-saja: perubahan accounting diblokir.'));
    }
    return nativeFetch(input, init);
  };
})(window);
