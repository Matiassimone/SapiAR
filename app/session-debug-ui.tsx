import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

/**
 * Shared visual language for the debug screens: grouped sections, icon +
 * label + value rows, and card-per-datum lists. Unicode glyphs stand in for
 * an icon set on purpose — no icon library exists in this project and one
 * isn't worth adding for internal tooling (Ponytail rung 5 check came up
 * empty).
 */

export type GlyphKind = 'pass' | 'fail' | 'neutral' | 'info'

const GLYPHS: Record<GlyphKind, { char: string; color: string }> = {
  pass: { char: '✓', color: '#34c759' },
  fail: { char: '✕', color: '#ff453a' },
  neutral: { char: '–', color: '#8e8e93' },
  info: { char: '▸', color: '#4a90d9' },
}

function Glyph({ kind }: { kind: GlyphKind }) {
  const glyph = GLYPHS[kind]
  return (
    <View style={[ui.glyphCircle, { borderColor: glyph.color }]}>
      <Text style={[ui.glyphChar, { color: glyph.color }]}>{glyph.char}</Text>
    </View>
  )
}

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
    <View style={ui.infoRow}>
      <Glyph kind={kind} />
      <Text style={ui.infoLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[ui.infoValue, valueColor != null && { color: valueColor }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

export function InfoSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <View style={ui.section}>
      <Text style={ui.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={ui.sectionBody}>{children}</View>
    </View>
  )
}

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
        ui.card,
        height != null && { height },
        accentColor != null && {
          borderLeftWidth: 3,
          borderLeftColor: accentColor,
        },
      ]}
    >
      <Text style={ui.cardTitle}>{title}</Text>
      <View style={ui.cardGrid}>
        {fields.map((field) => (
          <Text key={field.label} style={ui.cardField} numberOfLines={1}>
            {field.label}: <Text style={ui.cardValue}>{field.value}</Text>
          </Text>
        ))}
      </View>
    </View>
  )
}

const ui = StyleSheet.create({
  glyphCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  glyphChar: { fontSize: 11, fontWeight: '700', lineHeight: 13 },
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
  section: { marginHorizontal: 12, marginBottom: 14 },
  sectionTitle: {
    color: '#8e8e93',
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: 6,
    marginLeft: 4,
  },
  sectionBody: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
  },
  cardTitle: { color: '#fff', fontSize: 12, marginBottom: 6 },
  cardGrid: { gap: 2 },
  cardField: { color: '#8e8e93', fontSize: 11 },
  cardValue: { color: '#ddd', fontFamily: 'Menlo', fontSize: 11 },
})
