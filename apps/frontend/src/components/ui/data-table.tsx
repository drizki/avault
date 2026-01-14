import * as React from 'react'
import { Search, X, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  filterable?: boolean
  render?: (item: T) => React.ReactNode
  className?: string
  headerClassName?: string
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  searchPlaceholder?: string
  searchKeys?: string[]
  onRowClick?: (item: T) => void
  rowClassName?: string | ((item: T) => string)
  emptyState?: React.ReactNode
  actions?: (item: T) => React.ReactNode
}

type SortDirection = 'asc' | 'desc' | null

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part) => (acc && typeof acc === 'object' && part in acc) ? (acc as Record<string, unknown>)[part] : undefined, obj)
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  searchPlaceholder = 'Search...',
  searchKeys = [],
  onRowClick,
  rowClassName,
  emptyState,
  actions,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDirection, setSortDirection] = React.useState<SortDirection>(null)

  // Filter data based on search query
  const filteredData = React.useMemo(() => {
    if (!searchQuery.trim()) return data

    const query = searchQuery.toLowerCase()
    return data.filter((item) => {
      // Search in specified keys
      if (searchKeys.length > 0) {
        return searchKeys.some((key) => {
          const value = getNestedValue(item, key)
          return value?.toString().toLowerCase().includes(query)
        })
      }

      // Default: search in all column keys
      return columns.some((col) => {
        if (col.filterable === false) return false
        const value = getNestedValue(item, col.key)
        return value?.toString().toLowerCase().includes(query)
      })
    })
  }, [data, searchQuery, searchKeys, columns])

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortKey || !sortDirection) return filteredData

    return [...filteredData].sort((a, b) => {
      const aVal = getNestedValue(a, sortKey)
      const bVal = getNestedValue(b, sortKey)

      if (aVal === bVal) return 0
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      const comparison = aVal < bVal ? -1 : 1
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [filteredData, sortKey, sortDirection])

  function handleSort(key: string) {
    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else if (sortDirection === 'desc') {
        setSortKey(null)
        setSortDirection(null)
      }
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  function getSortIcon(key: string) {
    if (sortKey !== key) {
      return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50" />
    }
    if (sortDirection === 'asc') {
      return <ChevronUp className="h-3 w-3" />
    }
    return <ChevronDown className="h-3 w-3" />
  }

  return (
    <div className="space-y-2">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 pr-8"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
            onClick={() => setSearchQuery('')}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Results count */}
      {searchQuery && (
        <div className="text-xs text-muted-foreground px-1">
          {sortedData.length} of {data.length} results
        </div>
      )}

      {/* Table */}
      <div className="border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.sortable !== false && 'cursor-pointer select-none',
                    column.headerClassName
                  )}
                  onClick={() => column.sortable !== false && handleSort(column.key)}
                >
                  <div className="flex items-center gap-1">
                    {column.header}
                    {column.sortable !== false && getSortIcon(column.key)}
                  </div>
                </TableHead>
              ))}
              {actions && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (actions ? 1 : 0)}
                  className="h-32 text-center"
                >
                  {emptyState || (
                    <span className="text-muted-foreground">No results found</span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item) => (
                <TableRow
                  key={item.id}
                  className={cn(
                    onRowClick && 'cursor-pointer',
                    typeof rowClassName === 'function' ? rowClassName(item) : rowClassName
                  )}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      {column.render
                        ? column.render(item)
                        : (getNestedValue(item, column.key) as React.ReactNode)}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {actions(item)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
