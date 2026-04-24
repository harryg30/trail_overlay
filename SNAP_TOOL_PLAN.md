# Snap-to-Trail Implementation Plan

## Status
- ✅ Cursor handling updated (map-cursor.ts)
- ✅ UI button added (TrailEditDrawer.tsx)
- ✅ Type definitions updated (lib/modes/types.ts)
- ✅ Valhalla utils created (lib/valhalla-utils.ts)
- ✅ State added to LeafletMap (snapFirstPoint, snapLoading)
- ✅ Snap click handler implemented in LeafletMap
- ✅ Cleanup effect added for snap state
- ✅ Build passing - ready for testing

## Remaining Work

Core snap-tool implementation is complete in `LeafletMap.tsx`. The implementation includes:
- Snap click handler that intelligently routes through all waypoints
- Anchor point tracking and visual distinction
- Drag-and-drop rerouting for anchor points
- Proper async state management

### 1. Visual Feedback (Optional UX Enhancement)
**Location:** New useEffect in LeafletMap  
**Task:** Show marker/line for first snap point while waiting for second click (improved visual feedback during multi-point selection)

## Key Implementation Notes
- Snap tool click handling is implemented via async handler in `LeafletMap.tsx`
- `snapLoading` prevents duplicate requests
- Snap state clears after all routes complete and when leaving the tool
- Anchor points are tracked and distinct from routed polyline points
