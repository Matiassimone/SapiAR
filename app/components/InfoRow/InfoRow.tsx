import { Text, View } from 'react-native'

import { Glyph, type GlyphKind } from '../Glyph'
import { styles } from './InfoRow.styles'

export function InfoRow({
  kind = 'info',
  label,
  value,
  valueColor,
}: {
  kind?: GlyphKind
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <View style={styles.infoRow}>
      <Glyph kind={kind} />
      <Text style={styles.infoLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.infoValue, valueColor != null && { color: valueColor }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}
