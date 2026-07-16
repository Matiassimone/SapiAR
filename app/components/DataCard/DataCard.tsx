import { Text, View } from 'react-native'

import { styles } from './DataCard.styles'

export function DataCard({
  title,
  accentColor,
  fields,
  height,
}: {
  title: string
  accentColor?: string
  fields: { label: string; value: string }[]
  /** Fixed height so virtualized lists can use getItemLayout. */
  height?: number
}) {
  return (
    <View
      style={[
        styles.card,
        height != null && { height },
        accentColor != null && {
          borderLeftWidth: 3,
          borderLeftColor: accentColor,
        },
      ]}
    >
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.cardGrid}>
        {fields.map((field) => (
          <Text key={field.label} style={styles.cardField} numberOfLines={1}>
            {field.label}: <Text style={styles.cardValue}>{field.value}</Text>
          </Text>
        ))}
      </View>
    </View>
  )
}
