"""Generate public empty installation data and a generic offline pinyin dictionary.

Never reads desktop records, configuration, pictures, or backups. Personal data
can be transferred only by the user's explicit in-app backup import.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / 'app/src/main/assets'


def public_seed():
    return {'format': 'idol-tracker-backup', 'version': 2, 'app_version': '1.1.1',
            'records': [], 'config': {'monthly_budget': 0}, 'assets': {'images': {}}}


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / 'www').mkdir(exist_ok=True)
    (ASSETS / 'seed-backup.json').write_text(
        json.dumps(public_seed(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    try:
        from pypinyin import lazy_pinyin
        dictionary = {chr(code): lazy_pinyin(chr(code))[0] for code in range(0x3400, 0xA000)}
    except ImportError:
        # Re-emit the already bundled generic CJK dictionary without executing it.
        source = (ASSETS / 'www/pinyin.js').read_text(encoding='utf-8').strip()
        prefix = 'window.IdolPinyin='
        if not source.startswith(prefix) or not source.endswith(';'):
            raise RuntimeError('缺少 pypinyin，且未找到可复用的通用离线拼音字典。')
        dictionary = json.loads(source[len(prefix):-1])
        if set(dictionary) != {chr(code) for code in range(0x3400, 0xA000)}:
            raise RuntimeError('通用拼音字典的字符范围不完整。')
        if any(not isinstance(value, str) or not (value == key or (value.isascii() and value.isalpha()))
               for key, value in dictionary.items()):
            raise RuntimeError('通用拼音字典包含异常内容。')
    (ASSETS / 'www/pinyin.js').write_text(
        'window.IdolPinyin=' + json.dumps(dictionary, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print('Public seed generated: records=0, interactions=0, images=0, monthly_budget=0. No desktop data read.')


if __name__ == '__main__':
    main()
