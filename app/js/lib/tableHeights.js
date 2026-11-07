/*
 * 表格容器高度试调工具（临时调试用，不参与任何业务逻辑）
 *
 * 用途：装备页/英雄页表格高度是写死在 style.css 里的固定像素，改一次要重启；
 * 这个工具把高度改成内联样式，可以在 DevTools 控制台里直接试，满意后再抄回 CSS。
 *
 * 用法（F12 控制台）：
 *   TableHeights.current()                    // 打印四个表格当前的高度、外壳、能放几行
 *   TableHeights.apply({ builds: 176 })       // 临时把 builds 容器高度改成 176（其它不动）
 *   TableHeights.fit('builds', 4)             // 自动算"正好 4 行"需要的高度并应用
 *   TableHeights.fit('heroes', 8)             // 英雄表正好 8 行
 *   TableHeights.fit('gvg', 8)                // GVG 作业表正好 8 行
 *   TableHeights.reset()                      // 去掉内联高度，回到 CSS 的值
 *   TableHeights.fit('builds', 4, -1)         // 第三个参数是额外余量（默认 0，负数可消掉半行）
 */

const TABLES = {
    heroes: {
        container: '.heroesTableContainer',
        grid: '#heroes-table',
        rowHeight: 36,
    },
    builds: {
        container: '.buildsTableContainer',
        grid: '#builds-table',
        rowHeight: 27,
    },
    gear: {
        container: '.gearGridContainer',
        grid: '#gear-grid',
        rowHeight: 27,
    },
    gvg: {
        container: '.gvgTableContainer',
        grid: '#gvg-plans-table',
        rowHeight: 36,
    },
};

function rect(element) {
    return element ? element.getBoundingClientRect() : null;
}

function measure(tableKey) {
    const config = TABLES[tableKey];
    const container = document.querySelector(config.container);
    const grid = document.querySelector(config.grid);
    if (!container || !grid) return null;

    const header = grid.querySelector('.ag-header');
    const paging = grid.querySelector('.ag-paging-panel');
    const scrollStrip = grid.querySelector('.ag-body-horizontal-scroll');
    const bodyViewport = grid.querySelector('.ag-body-viewport');

    const containerHeight = Math.round(container.getBoundingClientRect().height);
    const headerHeight = header ? Math.round(header.getBoundingClientRect().height) : 0;
    const pagingHeight = paging ? Math.round(paging.getBoundingClientRect().height) : 0;
    const stripHeight = scrollStrip ? Math.round(scrollStrip.getBoundingClientRect().height) : 0;
    const bodyHeight = bodyViewport ? Math.round(bodyViewport.getBoundingClientRect().height) : 0;
    const chrome = containerHeight - bodyHeight;

    return {
        table: tableKey,
        container: containerHeight,
        header: headerHeight,
        paging: pagingHeight,
        scrollStrip: stripHeight,
        bodyViewport: bodyHeight,
        chrome,
        rowHeight: config.rowHeight,
        rowsFit: Math.floor(bodyHeight / config.rowHeight),
        leftover: bodyHeight - Math.floor(bodyHeight / config.rowHeight) * config.rowHeight,
    };
}

function log(rows) {
    console.table(rows.filter(Boolean));
    rows.filter(Boolean).forEach((row) => {
        console.log(
            `${row.table}: 容器 ${row.container}px = 外壳 ${row.chrome}px（表头 ${row.header} + 分页 ${row.paging} + 横条 ${row.scrollStrip} + 边框）`
            + ` + 表体 ${row.bodyViewport}px；${row.rowHeight}px 一行 → 完整 ${row.rowsFit} 行，剩 ${row.leftover}px`
        );
    });
}

module.exports = {
    current: () => {
        const rows = Object.keys(TABLES).map(measure);
        log(rows);
        return rows;
    },

    measure: (tableKey) => measure(tableKey),

    apply: (overrides) => {
        Object.keys(overrides).forEach((tableKey) => {
            const config = TABLES[tableKey];
            const container = config && document.querySelector(config.container);
            if (!container) {
                console.warn('找不到表格容器:', tableKey);
                return;
            }
            const height = Number(overrides[tableKey]);
            if (!Number.isFinite(height)) return;
            container.style.height = height + 'px';
            container.style.minHeight = height + 'px';
        });
        module.exports.current();
    },

    fit: (tableKey, rows, extra = 0) => {
        const before = measure(tableKey);
        if (!before) {
            console.warn('找不到表格:', tableKey);
            return null;
        }
        const height = before.chrome + rows * before.rowHeight + extra;
        console.log(`${tableKey}: 外壳 ${before.chrome} + ${rows}×${before.rowHeight} + 余量 ${extra} = ${height}px`);
        module.exports.apply({ [tableKey]: height });
        return height;
    },

    reset: () => {
        Object.keys(TABLES).forEach((tableKey) => {
            const container = document.querySelector(TABLES[tableKey].container);
            if (!container) return;
            container.style.height = '';
            container.style.minHeight = '';
        });
        console.log('已恢复 CSS 里的高度');
        module.exports.current();
    },
};
