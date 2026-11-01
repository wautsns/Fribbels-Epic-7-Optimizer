module.exports = {

    // [0, 0, 4, 2, 0, ...]
    renderSets: (setCounters, iconClass) => {
        return renderSets(setCounters, iconClass);
    },

    // 后端返回的英雄数据里 sets 一直是 null（StatCalculator 构造 HeroStats 时没带），
    // 这里用已装备的装备列表反推一份套装计数数组
    setsCounterFromEquipment: (equipment) => {
        return setsCounterFromEquipment(equipment);
    },

    renderStar: (value) => {
        return renderStar(value);
    },

    /*
     * 键盘上下切换行。
     * gridProvider 可选：组件化之后同一个页面可能有多个实例（英雄页 / GVG），
     * 不能只按名字去找全局单例，调用方可以直接把「本实例的 Grid」传进来。
     */
    arrowKeyNavigator: (binding, gridName, callback, gridProvider) => {
        return navigateToNextCell(binding, gridName, callback, gridProvider);
    }
}

function setsCounterFromEquipment(equipment) {
    const counters = Constants.setsByIndex.map(() => 0);
    if (!equipment) return counters;

    Object.values(equipment).forEach((item) => {
        const index = item && item.set ? Constants.setsByIndex.indexOf(item.set) : -1;
        if (index >= 0) counters[index] += 1;
    });
    return counters;
}

function renderSets(setCounters, iconClass) {
    if (!setCounters) return;
    if (!iconClass) iconClass = 'optimizerSetIcon';

    const sets = [];
    for (var i = 0; i < setCounters.length; i++) {
        const setsFound = Math.floor(setCounters[i] / Constants.piecesBySetIndex[i]);
        for (var j = 0; j < setsFound; j++) {
            sets.push(Constants.setsByIndex[i]);
        }
    }

    sets.sort((a, b) => {
        if (fourPieceSets.includes(a)) {
            return -1;
        } else if (fourPieceSets.includes(b)) {
            return 1;
        } else {
            return a.localeCompare(b);
        }
    })

    const images = sets.map(x => '<img class="' + iconClass + ' " src=' + Assets.getSetAsset(x) + '></img>');
    return images.join("");
}

const fourPieceSets = [
    "AttackSet",
    "SpeedSet",
    "DestructionSet",
    "LifestealSet",
    "ProtectionSet",
    "CounterSet",
    "RageSet",
    "RevengeSet",
    "InjurySet",
    "ReversalSet",
    "RiposteSet",
    "WarfareSet",
    "WeakeningSet"
]

function renderStar(value) {
    if (!value) return;

    if (value == "star") {
        return '<img class="optimizerStarIcon" src=' + Assets.getStar() + '></img>'
    }
}

// define some handy keycode constants
var KEY_LEFT = 37;
var KEY_UP = 38;
var KEY_RIGHT = 39;
var KEY_DOWN = 40;

function navigateToNextCell(params, gridName, callback, gridProvider) {
  return function(params) {
    var grid;
    if (typeof gridProvider === 'function') {
      // 组件实例自己给 Grid，不再依赖全局单例
      grid = gridProvider();
    } else if (gridName == "heroesGrid") {
      grid = heroesGrid;
    } else if (gridName == "optimizerGrid") {
      grid = optimizerGrid;
    } else if (gridName == "buildsGrid") {
      grid = buildsGrid;
    } else if (gridName == "itemsGrid") {
      grid = itemsGrid;
    }
    if (!grid) {
      console.warn("!GRID " + gridName, params, grid);

      return;
    }
    console.log(params, grid);

    var previousCell = params.previousCellPosition,
      suggestedNextCell = params.nextCellPosition,
      nextRowIndex,
      renderedRowCount;

    switch (params.key) {
      case KEY_DOWN:
        // return the cell below
        nextRowIndex = previousCell.rowIndex + 1;
        renderedRowCount = grid.gridOptions.api.getModel().getRowCount();
        if (nextRowIndex >= renderedRowCount) {
          return null;
        } // returning null means don't navigate

        var newSelectedNode = grid.gridOptions.api.getDisplayedRowAtIndex(nextRowIndex);
        grid.gridOptions.api.selectNode(newSelectedNode)

        if (callback) {
          callback(newSelectedNode);
        }
        return {
          rowIndex: nextRowIndex,
          column: previousCell.column,
          floating: previousCell.floating,
        };
      case KEY_UP:
        // return the cell above
        nextRowIndex = previousCell.rowIndex - 1;
        if (nextRowIndex <= -1) {
          return null;
        } // returning null means don't navigate

        var newSelectedNode = grid.gridOptions.api.getDisplayedRowAtIndex(nextRowIndex);
        grid.gridOptions.api.selectNode(newSelectedNode)

        if (callback) {
          callback(newSelectedNode);
        }
        return {
          rowIndex: nextRowIndex,
          column: previousCell.column,
          floating: previousCell.floating,
        };
      case KEY_LEFT:
      case KEY_RIGHT:
        return suggestedNextCell;
      default:
        throw 'this will never happen, navigation is always one of the 4 keys above';
    }
  }
}
