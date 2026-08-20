import { evaluateExpression, formatCellValue, isDate } from './expression'
import type { EvalScope } from './expression'

const DEFAULT_SUMMARIES: Record<string, (values: unknown[]) => unknown> = {
  Average: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number')
    if (!nums.length) return null
    return nums.reduce((a, b) => a + b, 0) / nums.length
  },
  Min: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number')
    if (!nums.length) return null
    return Math.min(...nums)
  },
  Max: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number')
    if (!nums.length) return null
    return Math.max(...nums)
  },
  Sum: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number')
    if (!nums.length) return null
    return nums.reduce((a, b) => a + b, 0)
  },
  Range: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number')
    if (nums.length) return Math.max(...nums) - Math.min(...nums)
    const dates = values.filter(isDate)
    if (dates.length >= 2) {
      const times = dates.map((d) => d.getTime())
      return Math.max(...times) - Math.min(...times)
    }
    return null
  },
  Median: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
    if (!nums.length) return null
    const mid = Math.floor(nums.length / 2)
    return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2
  },
  Stddev: (values) => {
    const nums = values.filter((v): v is number => typeof v === 'number')
    if (nums.length < 2) return null
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)
    return Math.sqrt(variance)
  },
  Earliest: (values) => {
    const dates = values.filter(isDate)
    if (!dates.length) return null
    return new Date(Math.min(...dates.map((d) => d.getTime())))
  },
  Latest: (values) => {
    const dates = values.filter(isDate)
    if (!dates.length) return null
    return new Date(Math.max(...dates.map((d) => d.getTime())))
  },
  Checked: (values) => values.filter((v) => v === true).length,
  Unchecked: (values) => values.filter((v) => v === false).length,
  Empty: (values) => values.filter((v) => v == null || v === '').length,
  Filled: (values) => values.filter((v) => v != null && v !== '').length,
  Unique: (values) => new Set(values.map((v) => formatCellValue(v))).size,
}

export function computeSummary(
  name: string,
  values: unknown[],
  customSummaries: Record<string, string> | undefined,
  scopeBase: Omit<EvalScope, 'values'>,
): unknown {
  const builtin = DEFAULT_SUMMARIES[name]
  if (builtin) return builtin(values)
  const custom = customSummaries?.[name]
  if (custom) {
    return evaluateExpression(custom, { ...scopeBase, values })
  }
  // Treat unknown name as expression over `values`
  if (name.includes('(') || name.includes('.')) {
    return evaluateExpression(name, { ...scopeBase, values })
  }
  return null
}

export function formatSummaryValue(value: unknown): string {
  return formatCellValue(value)
}
