import {
  countByQualityFlag,
  deriveGapRuns,
  parseFrameCounts,
  parseLocationCsv,
  parseRawRows,
} from './csvReader'

const LOCATION_HEADER =
  'Timestamp_unix_ms,Lat,Long,Speed_m_s,Course_deg,CourseAccuracy_deg,HorizontalAccuracy_m,VerticalAccuracy_m,is_interpolated,quality_flag'

function csv(...rows: string[]): string {
  return [LOCATION_HEADER, ...rows].join('\n') + '\n'
}

const OK_ROW = '1000,-38.01,-57.55,0,-1,-1,9.3,20,0,OK'
const LOW_ROW = '2000,-38.02,-57.56,-1,-1,-1,25,30,0,LOW_ACCURACY'
const ERROR_ROW = '-1,-1,-1,-1,-1,-1,-1,-1,0,ERROR'

describe('parseLocationCsv', () => {
  it('parses real, error, and interpolated rows with their flags', () => {
    const rows = parseLocationCsv(
      csv(OK_ROW, ERROR_ROW, '3000,-38.03,-57.57,-1,-1,-1,-1,-1,1,INTERP'),
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      timestampMs: 1000,
      lat: -38.01,
      long: -57.55,
      isInterpolated: false,
      qualityFlag: 'OK',
    })
    expect(rows[1]).toMatchObject({ timestampMs: -1, qualityFlag: 'ERROR' })
    expect(rows[2]).toMatchObject({
      timestampMs: 3000,
      isInterpolated: true,
      qualityFlag: 'INTERP',
    })
  })

  it('returns an empty array for a header-only file', () => {
    expect(parseLocationCsv(LOCATION_HEADER + '\n')).toEqual([])
  })
})

describe('countByQualityFlag', () => {
  it('counts every flag bucket', () => {
    const rows = parseLocationCsv(
      csv(
        OK_ROW,
        OK_ROW,
        LOW_ROW,
        ERROR_ROW,
        '3000,-38,-57,-1,-1,-1,-1,-1,1,INTERP',
      ),
    )
    expect(countByQualityFlag(rows)).toEqual({
      OK: 2,
      LOW_ACCURACY: 1,
      ERROR: 1,
      INTERP: 1,
    })
  })
})

describe('deriveGapRuns', () => {
  it('groups one contiguous INTERP run bounded by real fixes', () => {
    const rows = parseLocationCsv(
      csv(
        '1000,-38,-57,0,-1,-1,9,20,0,OK',
        '3500,-38.1,-57.1,-1,-1,-1,-1,-1,1,INTERP',
        '6000,-38.2,-57.2,-1,-1,-1,-1,-1,1,INTERP',
        '8500,-38.3,-57.3,0,-1,-1,9,20,0,OK',
      ),
    )
    expect(deriveGapRuns(rows)).toEqual([
      {
        startMs: 1000,
        endMs: 8500,
        durationMs: 7500,
        interpCount: 2,
      },
    ])
  })

  it('reports each separate run as its own gap', () => {
    const rows = parseLocationCsv(
      csv(
        '1000,-38,-57,0,-1,-1,9,20,0,OK',
        '3500,-38.1,-57.1,-1,-1,-1,-1,-1,1,INTERP',
        '6000,-38.2,-57.2,0,-1,-1,9,20,0,OK',
        '10500,-38.3,-57.3,-1,-1,-1,-1,-1,1,INTERP',
        '15000,-38.4,-57.4,0,-1,-1,9,20,0,OK',
      ),
    )
    const runs = deriveGapRuns(rows)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({
      startMs: 1000,
      endMs: 6000,
      interpCount: 1,
    })
    expect(runs[1]).toMatchObject({
      startMs: 6000,
      endMs: 15000,
      interpCount: 1,
    })
  })

  it('ignores ERROR sentinel rows when finding run boundaries', () => {
    const rows = parseLocationCsv(
      csv(
        '1000,-38,-57,0,-1,-1,9,20,0,OK',
        ERROR_ROW,
        '3500,-38.1,-57.1,-1,-1,-1,-1,-1,1,INTERP',
        '8500,-38.3,-57.3,0,-1,-1,9,20,0,OK',
      ),
    )
    expect(deriveGapRuns(rows)).toEqual([
      { startMs: 1000, endMs: 8500, durationMs: 7500, interpCount: 1 },
    ])
  })

  it('returns no gaps for an all-real stream', () => {
    expect(deriveGapRuns(parseLocationCsv(csv(OK_ROW, LOW_ROW)))).toEqual([])
  })
})

describe('parseFrameCounts', () => {
  it('counts rows per camera source', () => {
    const content = 'Timestamp,Source\n1,Front\n2,Back\n3,Front\n4,Front\n'
    expect(parseFrameCounts(content)).toEqual({ front: 3, back: 1 })
  })

  it('returns zeros for a header-only file', () => {
    expect(parseFrameCounts('Timestamp,Source\n')).toEqual({
      front: 0,
      back: 0,
    })
  })
})

describe('parseRawRows', () => {
  it('splits data lines into column arrays', () => {
    expect(parseRawRows('A,B\n1,x\n2,y\n')).toEqual([
      ['1', 'x'],
      ['2', 'y'],
    ])
  })
})

describe('timestamp uniqueness contract', () => {
  it('preserves duplicate-timestamp rows — timestamps are NOT unique row ids', () => {
    // GOAL.md wants every available update: a redelivered fix or two fixes
    // rounding to the same integer ms are legitimate distinct rows. Viewers
    // must key rows by position, never by timestamp.
    const content =
      'Timestamp_unix_ms,Lat,Long,Speed_m_s,Course_deg,CourseAccuracy_deg,HorizontalAccuracy_m,VerticalAccuracy_m,is_interpolated,quality_flag\n' +
      '1000,-38.01,-57.55,0,-1,-1,9,20,0,OK\n' +
      '1000,-38.01,-57.55,0,-1,-1,9,20,0,OK\n'
    const rows = parseLocationCsv(content)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.timestampMs).toBe(rows[1]?.timestampMs)
  })
})
