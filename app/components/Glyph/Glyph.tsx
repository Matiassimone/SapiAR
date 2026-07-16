import { Text, View } from 'react-native'

import { styles } from './Glyph.styles'

/**
 * Unicode glyphs stand in for an icon set. No icon library exists in this
 * project and one isn't worth adding for internal tooling. The Ponytail
 * rung 5 check came up empty.
 */
export type GlyphKind = 'pass' | 'fail' | 'neutral' | 'info'

const GLYPHS: Record<GlyphKind, { char: string; color: string }> = {
  pass: { char: '✓', color: '#34c759' },
  fail: { char: '✕', color: '#ff453a' },
  neutral: { char: '–', color: '#8e8e93' },
  info: { char: '▸', color: '#4a90d9' },
}

export function Glyph({ kind }: { kind: GlyphKind }) {
  const glyph = GLYPHS[kind]
  return (
    <View style={[styles.glyphCircle, { borderColor: glyph.color }]}>
      <Text style={[styles.glyphChar, { color: glyph.color }]}>
        {glyph.char}
      </Text>
    </View>
  )
}
