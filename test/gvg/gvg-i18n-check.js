/* 校验 GVG 用到的所有 i18n key 在 en/zh 都存在 */
const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync('data/locales/en/translation.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('data/locales/zh/translation.json', 'utf8'));

const files = fs.readdirSync('app/js/lib/gvg')
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('app/js/lib/gvg', f));

const keys = new Set();

for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/i18next\.t\(\s*'([^']+)'/g)) keys.add(match[1]);
    for (const match of text.matchAll(/i18next\.t\(\s*"([^"]+)"/g)) keys.add(match[1]);
    // validateDraft 返回的都是可翻译的错误 key
    for (const match of text.matchAll(/return '([A-Z][^']*)';/g)) {
        if (match[1].includes(' ')) keys.add(match[1]);
    }
    // POSITION_LABEL_KEYS 里的值
    for (const match of text.matchAll(/(?:front|bottom|top|back):\s*'([^']+)'/g)) keys.add(match[1]);
}

const html = fs.readFileSync('app/app.html', 'utf8');
const gvgSection = html.split('id="gvg-section"')[1].split('id="heroes-section"')[0];
for (const match of gvgSection.matchAll(/data-t>([^<]+)</g)) { if (match[1].trim()) keys.add(match[1].trim()); }
for (const match of gvgSection.matchAll(/value="([^"]+)"[^>]*data-t/g)) keys.add(match[1].trim());

keys.delete('');
const missingEn = [...keys].filter((key) => !(key in en));
const missingZh = [...keys].filter((key) => !(key in zh));
const untranslatedZh = [...keys].filter((key) => key in zh && zh[key] === key && /[A-Za-z]/.test(key));

console.log('checked keys: ' + keys.size);
if (missingEn.length) console.log('missing in en: ' + JSON.stringify(missingEn));
if (missingZh.length) console.log('missing in zh: ' + JSON.stringify(missingZh));
if (untranslatedZh.length) console.log('zh 与 en 相同(可能漏译): ' + JSON.stringify(untranslatedZh));

const failures = missingEn.length + missingZh.length + untranslatedZh.length;
console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
