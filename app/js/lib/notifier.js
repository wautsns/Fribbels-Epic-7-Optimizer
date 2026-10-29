var AWN = require('awesome-notifications').default
var globalOptions = {
}
var notifier = new AWN(globalOptions)

// Persistent toast: duration <= 0 disables the library's auto dismiss timer
function stickyToast(text, translate) {
    const el = notifier.info(translate ? i18next.t(text) : text, { durations: { info: 0 } });
    return {
        close: () => {
            try {
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            } catch (error) {
                // ignore
            }
        },
    };
}

module.exports = {
    initialize: () => {
        globalOptions = {
            icons: {enabled: true},
            labels: {
                warning: i18next.t("Warning"),
                alert: i18next.t("Alert"),
                info: i18next.t("Info"),
                success: i18next.t("Success"),
                error: i18next.t("Error"),
            },
            durations: {
                alert: 20000,
                warning: 20000,
                info: 7500,
            },
            position: 'top-right'
        }
        notifier = new AWN(globalOptions)
    },

    info: (text) => {
        notifier.info(i18next.t(text));
    },

    // stays on screen until close() is called
    sticky: (text) => stickyToast(text, true),
    stickyRaw: (text) => stickyToast(text, false),

    success: (text) => {
        notifier.success(i18next.t(text));
    },

    quick: (text) => {
        notifier.success(i18next.t(text), {durations: {success: 2000}});
    },

    error: (text) => {
        notifier.alert(i18next.t(text));
    },

    warn: (text) => {
        notifier.warning(i18next.t(text));
    },

    /*
     * Raw 变体：文本已经翻译过（或带运行期数据），不再走 i18next.t。
     * 用于「已移除 N 条」这类带数字的提示，避免把拼好的句子当成缺失 key 写进 translation.missing.json。
     */
    infoRaw: (text) => {
        notifier.info(text);
    },

    successRaw: (text) => {
        notifier.success(text);
    },

    warnRaw: (text) => {
        notifier.warning(text);
    },

    errorRaw: (text) => {
        notifier.alert(text);
    },
}
