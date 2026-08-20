/**
 * 素材名拼音检索串(拼音/模糊搜索,对标 Eagle)。
 * 素材名含 CJK 时生成两串:
 *  - full:    全拼小写串联(去非字母数字),如「人物造型概念参考」→ renwuzaoxinggainiancankao
 *  - initial: 首字母小写串联(去非字母),如「人物造型概念参考」→ rwzxgnck
 * 纯 ASCII 名返回空串——检索侧沿用 name LIKE,不生成冗余拼音。
 * 依赖 pinyin-pro(纯 JS 无原生模块,支持多音字:重庆→chongqing)。
 */
import { pinyin } from 'pinyin-pro'

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/

export interface NamePinyin {
  /** 全拼小写串联(无空格无标点),无 CJK 时 '' */
  full: string
  /** 首字母小写串联,无 CJK 时 '' */
  initial: string
}

export function computeNamePinyin(name: string): NamePinyin {
  if (!name || !CJK_RE.test(name)) return { full: '', initial: '' }
  try {
    const full = pinyin(name, { toneType: 'none', type: 'array' })
      .join('')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    const initial = pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' })
      .join('')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
    return { full, initial }
  } catch {
    // 拼音计算失败不阻断导入/改名:返回空串,检索退化为 name LIKE
    return { full: '', initial: '' }
  }
}
