"""Build a signed offline APK with the installed official Android SDK and JDK 17.

python build.py              # public production APK (includes only an empty seed)
python build.py --native-only # compile native code without packaging unfinished assets
Signing material remains in private-signing/ and must be retained for future updates.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
TOOLS = Path(os.environ.get('IDOL_ANDROID_TOOLS', str(ROOT.parent.parent / 'android-build-tools')))
JDK = TOOLS / 'jdk17' / 'bin'
SDK = TOOLS / 'sdk'
BT = SDK / 'build-tools' / '35.0.0'
ANDROID = SDK / 'platforms' / 'android-35' / 'android.jar'
BUILD = ROOT / 'build'
SIGNING = ROOT / 'private-signing'
VERSION = '1.1.1'
VERSION_CODE = 3
OUT = ROOT / 'release' / VERSION
PRIVATE = ROOT / 'private-test-artifacts' / VERSION
APK = OUT / ('偶像活动手账_Android_v' + VERSION + '.apk')
LEGACY_APK = ROOT / 'release/偶像活动手账_Android_v1.0.0.apk'
UPGRADE_APK = ROOT / 'release/1.1.0/偶像活动手账_Android_v1.1.0.apk'
ASSET_ALLOWLIST = (
    'seed-backup.json', 'www/index.html', 'www/style.css', 'www/stats.css',
    'www/core.js', 'www/pinyin.js', 'www/stats-ui.js', 'www/app.js',
)


def validate_public_assets():
    assets = ROOT / 'app/src/main/assets'
    for relative in ASSET_ALLOWLIST:
        if not (assets / relative).is_file():
            raise RuntimeError('缺少公开应用资源：' + relative)
    from prepare_seed import public_seed
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise RuntimeError('公开种子包含重复 JSON 字段。')
            result[key] = value
        return result
    seed = json.loads((assets / 'seed-backup.json').read_text(encoding='utf-8-sig'), object_pairs_hook=unique_object)
    if json.dumps(seed, sort_keys=True) != json.dumps(public_seed(), sort_keys=True):
        raise RuntimeError('公开 APK 种子必须是严格空白的 version 2 数据；不允许历史、图片、预算或 source/exported 私人字段。请运行 prepare_seed.py。')
    return assets


def run(*args):
    subprocess.run([str(args[0])] + [os.path.relpath(a, ROOT) if isinstance(a, Path) else str(a)
                                   for a in args[1:]], check=True, cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-only', action='store_true')
    args = parser.parse_args()
    assets = validate_public_assets() if not args.native_only else None
    for path in (JDK/'java.exe', JDK/'javac.exe', BT/'aapt2.exe', ANDROID):
        if not path.exists():
            raise RuntimeError('缺少构建工具：' + str(path) + '。可通过 IDOL_ANDROID_TOOLS 指定工具目录。')
    # Delete only generated files inside this project's build directory, never source data.
    if BUILD.exists():
        if BUILD.resolve().parent != ROOT.resolve():
            raise RuntimeError('Unexpected build directory')
        shutil.rmtree(BUILD)
    for directory in (BUILD, BUILD/'generated', BUILD/'classes', BUILD/'dex', OUT, PRIVATE, SIGNING):
        directory.mkdir(parents=True, exist_ok=True)
    run(BT/'aapt2.exe', 'compile', '--dir', ROOT/'app/src/main/res', '-o', BUILD/'resources.zip')
    run(BT/'aapt2.exe', 'link', '-o', BUILD/'resources.apk', '--manifest', ROOT/'app/src/main/AndroidManifest.xml',
        '-I', ANDROID, '--java', BUILD/'generated', '--version-code', str(VERSION_CODE), '--version-name', VERSION, BUILD/'resources.zip')
    sources = list((ROOT/'app/src/main/java').rglob('*.java')) + list((BUILD/'generated').rglob('*.java'))
    boot = os.path.relpath(BT/'core-lambda-stubs.jar', ROOT) + os.pathsep + os.path.relpath(ANDROID, ROOT)
    run(JDK/'javac.exe', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', boot,
        '-d', BUILD/'classes', *sources)
    run(JDK/'jar.exe', 'cf', BUILD/'classes.jar', '-C', BUILD/'classes', '.')
    run(JDK/'java.exe', '-cp', BT/'lib/d8.jar', 'com.android.tools.r8.D8', '--release', '--min-api', '26',
        '--lib', ANDROID, '--output', BUILD/'dex', BUILD/'classes.jar')
    if args.native_only:
        print('Native code compiled successfully.')
        return
    unsigned = BUILD/'unsigned.apk'
    shutil.copyfile(BUILD/'resources.apk', unsigned)
    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as package:
        for dex in (BUILD/'dex').glob('*.dex'):
            package.write(dex, dex.name)
        for relative in ASSET_ALLOWLIST:
            package.write(assets / relative, 'assets/' + relative)
    run(BT/'zipalign.exe', '-P', '16', '-f', '4', unsigned, BUILD/'aligned.apk')
    password_file = SIGNING/'storepass.txt'
    keystore = SIGNING/'release.p12'
    if not keystore.is_file() or not password_file.is_file():
        raise RuntimeError('缺少 1.0.0 使用的签名密钥，不能生成可覆盖升级的公开版本；不会自动更换签名。')
    output = BUILD/'signed.apk'
    signer = [JDK/'java.exe', '-jar', BT/'lib/apksigner.jar']
    run(*signer, 'sign', '--ks', keystore, '--ks-key-alias', 'idoltracker', '--ks-pass', 'file:' + str(password_file),
        '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
        '--out', output, BUILD/'aligned.apk')
    verification = subprocess.check_output([str(v) for v in [*signer, 'verify', '--verbose', '--print-certs', output]],
                                           text=True, encoding='utf-8')
    if not LEGACY_APK.is_file():
        raise RuntimeError('找不到原始 1.0.0 APK，无法核对升级签名。')
    previous_verification = subprocess.check_output([str(v) for v in [*signer, 'verify', '--verbose', '--print-certs', LEGACY_APK]], text=True, encoding='utf-8')
    certificate_line = 'Signer #1 certificate SHA-256 digest:'
    certificate = next(line for line in verification.splitlines() if line.startswith(certificate_line))
    previous_certificate = next(line for line in previous_verification.splitlines() if line.startswith(certificate_line))
    assert certificate == previous_certificate, '升级签名与 1.0.0 不一致'
    run(BT/'zipalign.exe', '-c', '-P', '16', '4', output)
    shutil.copyfile(output, BUILD/'inspect.apk')
    badging = subprocess.check_output([str(BT/'aapt.exe'), 'dump', 'badging', 'build/inspect.apk'],
                                      cwd=ROOT, text=True, encoding='utf-8')
    assert 'uses-permission:' not in badging
    assert "sdkVersion:'26'" in badging and "targetSdkVersion:'35'" in badging
    assert 'application-debuggable' not in badging
    assert "package: name='cn.local.idoltracker'" in badging
    assert ("versionCode='" + str(VERSION_CODE) + "'") in badging and ("versionName='" + VERSION + "'") in badging
    with zipfile.ZipFile(output) as package:
        assert sorted(name for name in package.namelist() if name.startswith('assets/')) == sorted('assets/' + name for name in ASSET_ALLOWLIST)
    # Publish only after package identity, signature, alignment and public assets pass.
    shutil.copyfile(output, APK)
    output = APK
    (PRIVATE/'APK签名验证.txt').write_text(verification, encoding='utf-8')
    (PRIVATE/'APK信息.txt').write_text(badging, encoding='utf-8')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (OUT/'SHA256.txt').write_text(digest + '  ' + output.name + '\n', encoding='utf-8')
    print(verification)
    print('APK:', output, 'bytes:', output.stat().st_size, 'SHA256:', digest)


if __name__ == '__main__':
    main()
