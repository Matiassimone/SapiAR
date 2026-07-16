import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  infoLabel: { color: '#ddd', fontSize: 13, flex: 1 },
  infoValue: { color: '#8e8e93', fontFamily: 'Menlo', fontSize: 12 },
})
