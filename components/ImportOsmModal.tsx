'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface ImportOsmModalProps {
  bbox: { north: number; south: number; east: number; west: number }
  onClose: () => void
  onSubmit: (regionName: string, filters: any) => void
}

export function ImportOsmModal({ bbox, onClose, onSubmit }: ImportOsmModalProps) {
  const [regionName, setRegionName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    try {
      await onSubmit(regionName || 'Unknown Region', { instructions })
      onClose()
    } catch (error) {
      console.error('Import failed:', error)
      setSubmitting(false)
    }
  }

  const area = calculateAreaKm2(bbox)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Import Trails from OpenStreetMap</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Region name */}
          <div>
            <label htmlFor="region-name" className="block text-sm font-medium">
              Region Name
            </label>
            <input
              id="region-name"
              type="text"
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
              placeholder="e.g., Moab, Utah"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Bbox info */}
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="font-medium">Selected Area</div>
            <div className="mt-1 text-muted-foreground">
              <div>Approx. {area.toFixed(1)} km²</div>
              <div className="mt-1 text-xs">
                N: {bbox.north.toFixed(4)}, S: {bbox.south.toFixed(4)}
              </div>
              <div className="text-xs">
                E: {bbox.east.toFixed(4)}, W: {bbox.west.toFixed(4)}
              </div>
            </div>
          </div>

          {/* Additional instructions */}
          <div>
            <label htmlFor="instructions" className="block text-sm font-medium">
              Additional Instructions (optional)
            </label>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., Prefer shuttle/downhill trails, exclude hiking-only paths, prioritize loop trails..."
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
            />
          </div>
          <div className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              Claude AI will analyze and rank trails from OpenStreetMap in this area.
              You'll be able to review and approve trails before importing.
            </p>
            <p className="mt-2">
              <strong>Quota:</strong> 10 imports/day per user
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Importing...' : 'Import Trails'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function calculateAreaKm2(bbox: {
  north: number
  south: number
  east: number
  west: number
}): number {
  // Rough approximation using average latitude
  const avgLat = (bbox.north + bbox.south) / 2
  const latDiff = bbox.north - bbox.south
  const lonDiff = bbox.east - bbox.west

  // 1 degree latitude ≈ 111 km
  // 1 degree longitude ≈ 111 km * cos(latitude)
  const latKm = latDiff * 111
  const lonKm = lonDiff * 111 * Math.cos((avgLat * Math.PI) / 180)

  return Math.abs(latKm * lonKm)
}
