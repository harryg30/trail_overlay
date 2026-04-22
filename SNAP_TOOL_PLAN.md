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

### 1. Add Snap Tool Click Handler (LeafletMap.tsx)
**Location:** Around line 687-691 in the map click handler  
**Task:** Add snap tool case after pencil tool check

```
if (drawToolActiveRef.current) {
  if (drawToolTypeRef.current === 'pencil') {
    stagedRef.current?.appendDrawPoint([e.latlng.lat, e.latlng.lng])
  } else if (drawToolTypeRef.current === 'snap') {
    // HANDLE SNAP TOOL HERE
    // 1. If snapFirstPointRef.current is null
    //    - Call snapToNearestWay(lat, lng)
    //    - Save result as first point
    //    - Show visual feedback
    // 2. If snapFirstPointRef.current is set
    //    - Call routeBetweenPoints(first, second) 
    //    - Append both points to draw
    //    - Clear snapFirstPointRef
  }
  return
}
```

### 2. Create Async Snap Handler Function
**Location:** Before map initialization in LeafletMap  
**Task:** Create `handleSnapClick` async function
- Takes click coordinates
- Calls snapToNearestWay or routeBetweenPoints
- Updates state (snapFirstPoint, snapLoading)
- Appends points to staged trail
- Handles errors gracefully

### 3. Clear Snap State on Mode Change
**Location:** When exiting draw mode in LeafletMap  
**Task:** Add cleanup to clear snapFirstPoint when user exits snap tool

### 4. Visual Feedback (Optional)
**Location:** New useEffect in LeafletMap  
**Task:** Show marker/line for first snap point while waiting for second click

## Key Notes
- Snap tool logic is **async** → must use async handler, not inline
- Use refs to preserve state in click handler
- snapLoading prevents duplicate requests
- Clear snapFirstPoint after routing completes
- Valhalla functions already handle API errors
