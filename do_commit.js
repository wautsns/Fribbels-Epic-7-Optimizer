const { execSync } = require('child_process');
const fs = require('fs');
const repo = 'd:/github/wautsns/Fribbels-Epic-7-Optimizer';
process.chdir(repo);

const out = 'd:/github/wautsns/Fribbels-Epic-7-Optimizer/git_out.txt';
fs.writeFileSync(out, '');

function run(cmd) {
    const full = `${cmd} >> "${out}" 2>&1`;
    fs.appendFileSync(out, `\n=== ${cmd} ===\n`);
    try {
        execSync(full, { encoding: 'utf8' });
        fs.appendFileSync(out, `[exit 0]\n`);
    } catch (e) {
        fs.appendFileSync(out, `[exit ${e.status}]\n`);
    }
}

const GIT = '"C:/Program Files/Git/cmd/git.exe"';

run(`${GIT} rev-parse --git-dir`);
run(`${GIT} config --get user.name`);
run(`${GIT} config --get user.email`);
run(`${GIT} --no-pager log --oneline -10`);
run(`${GIT} --no-pager status`);
run(`${GIT} --no-pager diff --name-only`);
run(`${GIT} add -A`);
run(`${GIT} commit -m "fix(emulator): correct SUITE_COORDS page 1 row ordering (FervorSet/WarfareSet swapped)"`);
run(`${GIT} --no-pager log --oneline -3`);
run(`${GIT} --no-pager status`);

console.log('done');
