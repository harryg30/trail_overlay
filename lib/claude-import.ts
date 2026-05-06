import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY!,
});

export interface ClaudeTrailResult {
  osmWayId: string;
  name: string;
  difficulty: 'easy' | 'intermediate' | 'hard' | 'pro' | 'not_set';
  type: 'mtb' | 'hiking' | 'mixed';
  score: number;
  reasoning: string;
  /** OSM ways that Claude grouped as the same trail (excluding this primary osmWayId). */
  mergedOsmWayIds: string[];
}

export interface ClaudeImportResponse {
  rankedTrails: ClaudeTrailResult[];
  reasoning: {
    totalAnalyzed: number;
    recommended: number;
    duplicatesFound: number;
    summary: string;
  };
}

const SYSTEM_PROMPT_CACHED = `You are a trail-data expert ranking and deduplicating OpenStreetMap trails for import into a mountain-biking / hiking database.

Your tasks:
1. **Identify duplicates** by recognizing semantic name equivalence and spatial proximity. Same trail may appear multiple times with name variations ("Porcupine Rim Trail" vs "Porcupine Rim", typos, abbreviations, "Trail" suffix variations, etc.). If start/end points are within ~100m and names are similar, they're likely the same trail — group them.
2. **Pick a primary** from each group (the most complete/longest), and list other osmWayIds as merged.
3. **Rank** the primary trails by quality.

GROUPING HINTS:
- Check endpoint proximity (start_lat/start_lon, end_lat/end_lon). Ways with aligned endpoints ~100m apart likely form one trail.
- Ignore common suffixes ("Trail", "Path", "Road", "Way", "Loop", "Connector", etc.) when comparing names.
- Normalize: lowercase, strip diacritics, treat hyphens/apostrophes as spaces.
- Consider network tags and operator tags — same operator often = related trails.
- Don't over-group: "Fire Road A" and "Fire Road B" are different, but "Porcupine Rim" and "Porcupine Rim Trail" are the same.

RANKING RULES:
1. Only recommend real, maintained trails
2. Exclude generic names ("Track", "Path", "Untitled") unless they have strong quality signals
3. Prefer trails with clear difficulty ratings and good metadata
4. Consider trail connectivity (trails in a network are more valuable)
5. Flag suspicious trails (e.g. private roads mistagged as trails)

DIFFICULTY MAPPING:
- mtb:scale 0-1 → easy; 2 → intermediate; 3-4 → hard; 5-6 → pro
- sac_scale: hiking → easy; mountain_hiking → intermediate; demanding_mountain_hiking → hard; alpine_hiking → pro
- No scale tags → not_set (infer from other tags if possible)

TYPE MAPPING:
- highway=path|track|cycleway with bicycle=yes/designated → mtb
- highway=path bicycle=no foot=yes → hiking
- bicycle + foot both yes → mixed

QUALITY SIGNALS (raise score): well-formed name (not generic), official=yes, operator, network membership, clear difficulty tags, surface/width/trail_visibility, reasonable length.
LOWER SIGNALS: unnamed/generic, missing tags, isolated, very short (<0.5km unless connector).`;

const RELEVANT_TAGS = new Set([
  'name',
  'highway',
  'bicycle',
  'foot',
  'mtb:scale',
  'mtb:scale:uphill',
  'sac_scale',
  'surface',
  'operator',
  'network',
  'official',
  'trail_visibility',
  'access',
  'ref',
  'width',
]);

function pickRelevantTags(tags: Record<string, any> | undefined): Record<string, any> {
  if (!tags) return {};
  const out: Record<string, any> = {};
  for (const k of Object.keys(tags)) {
    if (RELEVANT_TAGS.has(k)) out[k] = tags[k];
  }
  return out;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function rankOsmTrails(
  osmTrails: any[],
  existingTrailsSummary: string,
  regionName: string,
  additionalInstructions: string = ''
): Promise<{
  results: ClaudeImportResponse;
  usage: { inputTokens: number; outputTokens: number; cacheHit: boolean };
}> {
  // Strip irrelevant tags and extract endpoints for Claude grouping.
  const slimmed = osmTrails.map((t) => {
    const polyline: [number, number][] = t.polyline ?? [];
    return {
      osmWayId: t.osmWayId,
      name: t.name,
      distanceKm: Number((t.distanceKm ?? 0).toFixed(2)),
      startLat: polyline.length > 0 ? polyline[0][0] : null,
      startLon: polyline.length > 0 ? polyline[0][1] : null,
      endLat: polyline.length > 0 ? polyline[polyline.length - 1][0] : null,
      endLon: polyline.length > 0 ? polyline[polyline.length - 1][1] : null,
      tags: pickRelevantTags(t.tags),
    };
  });
  console.log(`[Claude import] Sending ${osmTrails.length} ways to Claude for grouping and ranking`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      temperature: 0.1,

      // Cached system prompt
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT_CACHED,
          cache_control: { type: 'ephemeral' },
        },
      ],

      messages: [
        {
          role: 'user',
          content: buildUserPrompt(slimmed, existingTrailsSummary, regionName, additionalInstructions),
        },
      ],
    });

    // Extract JSON from response - handle multiple text blocks
    let jsonText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        jsonText += block.text;
      }
    }

    if (!jsonText) {
      throw new Error('No text content in Claude response');
    }

    // Strip markdown code fence if present
    jsonText = jsonText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const results: ClaudeImportResponse = JSON.parse(jsonText);

    // Validate response structure
    if (!results.rankedTrails || !Array.isArray(results.rankedTrails)) {
      throw new Error('Invalid response structure: missing rankedTrails array');
    }

    // Validate each trail
    for (const trail of results.rankedTrails) {
      if (!trail.osmWayId || !trail.name || !trail.difficulty || !trail.type) {
        throw new Error(`Invalid trail data: ${JSON.stringify(trail)}`);
      }
      if (trail.score < 0 || trail.score > 100) {
        throw new Error(`Invalid score ${trail.score} for trail ${trail.osmWayId}`);
      }
      if (!Array.isArray(trail.mergedOsmWayIds)) {
        throw new Error(`Invalid mergedOsmWayIds for trail ${trail.osmWayId}`);
      }
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheHit: (response.usage as any).cache_read_input_tokens > 0,
    };

    return { results, usage };
  } catch (error: any) {
    // Preserve structured info from Anthropic SDK errors so the route + UI can
    // show the user *why* Claude failed (rate limit, prompt too long, 5xx, …).
    const status = error?.status ?? error?.response?.status;
    const apiType = error?.error?.error?.type ?? error?.error?.type;
    const apiMessage = error?.error?.error?.message ?? error?.error?.message ?? error?.message;
    console.error('[Claude import] API error:', {
      status,
      apiType,
      apiMessage,
      requestId: error?.request_id ?? error?.requestID,
    });
    const wrapped: any = new Error(
      apiMessage
        ? `Claude API error${status ? ` (${status})` : ''}${apiType ? ` [${apiType}]` : ''}: ${apiMessage}`
        : `Claude API error: ${error?.message ?? 'unknown'}`
    );
    wrapped.claude = true;
    wrapped.status = status;
    wrapped.apiType = apiType;
    wrapped.apiMessage = apiMessage;
    wrapped.requestId = error?.request_id ?? error?.requestID;
    throw wrapped;
  }
}

function buildUserPrompt(
  slimmedTrails: any[],
  existingTrailsSummary: string,
  regionName: string,
  additionalInstructions: string = ''
): string {
  const MAX_TRAILS_TO_CLAUDE = 300;
  const trimmed = slimmedTrails.slice(0, MAX_TRAILS_TO_CLAUDE);

  let prompt = `Group and rank these OpenStreetMap trails for import.

CONTEXT:
- Region: ${regionName}
- Existing trails nearby: ${existingTrailsSummary}
- PostGIS has already filtered duplicates (trails within 50m of existing)

TASK:
1. **Identify duplicates**: Same trail may appear multiple times with name variations, typos, or suffix differences. Use endpoint proximity (start_lat/start_lon, end_lat/end_lon within ~100m) + name similarity to group them.
2. **Pick primaries**: For each group, pick the primary (most complete/longest trail). List other osmWayIds as \`mergedOsmWayIds\`.
3. **Rank**: Score each primary trail 0-100 by quality.
4. **Return top 30-40** highest-scoring primaries.`;

  if (additionalInstructions.trim()) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${additionalInstructions}`;
  }

  prompt += `\n\nOSM TRAILS (raw, unmerged; has endpoints for spatial deduplication):
${JSON.stringify(trimmed)}${slimmedTrails.length > MAX_TRAILS_TO_CLAUDE ? `\n(showing first ${MAX_TRAILS_TO_CLAUDE} of ${slimmedTrails.length})` : ''}

OUTPUT (JSON only, exact shape):
{
  "rankedTrails": [
    {
      "osmWayId": "way/123",
      "name": "Trail Name",
      "difficulty": "easy" | "intermediate" | "hard" | "pro" | "not_set",
      "type": "mtb" | "hiking" | "mixed",
      "score": 0-100,
      "reasoning": "...",
      "mergedOsmWayIds": ["way/456", "way/789"]
    }
  ],
  "reasoning": {
    "totalAnalyzed": <number>,
    "recommended": <number>,
    "duplicatesFound": <number of ways merged>,
    "summary": "..."
  }
}

Use exact \`osmWayId\` strings from input. Do not invent IDs. Respond with JSON only.`;

  return prompt;
}
