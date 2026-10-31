module.exports = {

    draw: (before, after) => {
        $('#atkStatBefore').text(before.atk)
        $('#defStatBefore').text(before.def)
        $('#hpStatBefore').text(before.hp)
        $('#spdStatBefore').text(before.spd)
        $('#crStatBefore').text(before.cr)
        $('#cdStatBefore').text(before.cd)
        $('#effStatBefore').text(before.eff)
        $('#resStatBefore').text(before.res)
        $('#gsStatBefore').text(before.score)


        $('#atkStatAfter').text(after.atk)
        $('#defStatAfter').text(after.def)
        $('#hpStatAfter').text(after.hp)
        $('#spdStatAfter').text(after.spd)
        $('#crStatAfter').text(after.cr)
        $('#cdStatAfter').text(after.cd)
        $('#effStatAfter').text(after.eff)
        $('#resStatAfter').text(after.res)
        $('#gsStatAfter').text(after.score)

        // 套装图标：两套数据都能算（装备列表 equipment / 套装计数 sets），
        // 哪边拿得到就用哪边，拿不到就用另一边兜底，避免整排空着。
        const renderSetsSmart = (row) => {
            if (!row) return '';
            if (row.equipment) {
                const fromEquipment = renderSets(row.equipment, 'previewSet', false);
                if (fromEquipment) return fromEquipment;
            }
            if (row.sets) {
                return renderSets(row.sets, 'previewSet', true) || '';
            }
            return '';
        };

        $('#setBefore').html(renderSetsSmart(before));
        $('#setAfter').html(renderSetsSmart(after));
    },
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
    "WeakeningSet",
]

function renderSets(equipment, name, isAfter) {
    if (!equipment) return;

    var setCounters;

    if (isAfter) {
        setCounters = equipment;
    } else {
        // 空槽位是 null，直接取 .set 会抛错、把整块预览画挂掉
        const setNames = Object.values(equipment).filter(x => x).map(x => x.set);
        setCounters = [
            Math.floor(setNames.filter(x => x == "HealthSet").length),
            Math.floor(setNames.filter(x => x == "DefenseSet").length),
            Math.floor(setNames.filter(x => x == "AttackSet").length),
            Math.floor(setNames.filter(x => x == "SpeedSet").length),
            Math.floor(setNames.filter(x => x == "CriticalSet").length),
            Math.floor(setNames.filter(x => x == "HitSet").length),
            Math.floor(setNames.filter(x => x == "DestructionSet").length),
            Math.floor(setNames.filter(x => x == "LifestealSet").length),
            Math.floor(setNames.filter(x => x == "CounterSet").length),
            Math.floor(setNames.filter(x => x == "ResistSet").length),
            Math.floor(setNames.filter(x => x == "UnitySet").length),
            Math.floor(setNames.filter(x => x == "RageSet").length),
            Math.floor(setNames.filter(x => x == "ImmunitySet").length),
            Math.floor(setNames.filter(x => x == "PenetrationSet").length),
            Math.floor(setNames.filter(x => x == "RevengeSet").length),
            Math.floor(setNames.filter(x => x == "InjurySet").length),
            Math.floor(setNames.filter(x => x == "ProtectionSet").length),
            Math.floor(setNames.filter(x => x == "TorrentSet").length),
            Math.floor(setNames.filter(x => x == "ReversalSet").length),
            Math.floor(setNames.filter(x => x == "RiposteSet").length),
            Math.floor(setNames.filter(x => x == "WarfareSet").length),
            Math.floor(setNames.filter(x => x == "PursuitSet").length),
            Math.floor(setNames.filter(x => x == "WeakeningSet").length),
            Math.floor(setNames.filter(x => x == "FervorSet").length),
        ]
    }

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

    const iconClass = name || 'optimizerSetIcon';
    const images = sets.map(x => '<img class="' + iconClass + '" src=' + Assets.getSetAsset(x) + '></img>');
    // console.log("RenderSets images", images);
    return images.join("");
}

// 38821f
