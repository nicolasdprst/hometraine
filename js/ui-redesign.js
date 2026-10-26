(function (root) {
    'use strict';

    function init() {
        document.body.classList.add('ui-redesign-ready');
    }

    root.CycloUI = { init };
    document.addEventListener('DOMContentLoaded', init, { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
