import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { styles } from './InfoSection.styles'

/** iOS grouped-list section, a titled rounded card that wraps rows. */
export function InfoSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}
