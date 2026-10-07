// 自動生成・編集しない・再生成は npm run gen:jev
export const JEV_BASE_ALLOWED_COMMAND_IDS = [
  "akari.preview.ensureVisible",
  "akari.preview.seekOutput",
  "akari.preview.togglePlayback",
  "akari.preview.play",
  "akari.preview.pause",
  "akari.preview.setFullscreen",
  "akari.preview.setViewZoom",
  "akari.preview.setPlaybackRate",
  "akari.preview.setLoopRange",
  "akari.preview.enterCropMode",
  "akari.preview.openPerspectivePanel",
  "akari.preview.pulseItem",
  "akari.preview.showZoneHint",
  "akari.timeline.focusItem",
  "akari.timeline.seek",
  "akari.timeline.setView",
  "akari.timeline.setTool",
  "akari.timeline.setSnap",
  "akari.timeline.reveal",
  "akari.inspector.open",
  "akari.daihon.open",
  "akari.cuts.open",
  "akari.transcribe.openDialog",
  "akari.catalog.open",
  "akari.catalog.importAsset",
  "akari.catalog.listCategories",
  "akari.menu.focus",
  "akari.menu.listSkills",
  "akari.menu.listOpenTargets",
  "akari.review.open",
  "akari.review.board.open",
  "akari.partner.open",
  "akari.settings.open"
] as const;
export const JEV_DERIVED_COMMAND_IDS = [
  "akari.catalog.setMaterialFilter",
  "akari.catalog.setMaterialSort",
  "akari.catalog.setMaterialQuery",
  "akari.library.setFilter",
  "akari.catalog.clearFilters",
  "akari.settings.setByVoice"
] as const;
export const JEV_SETTINGS_OPEN_SECTIONS = [
  "account",
  "start",
  "export",
  "appearance",
  "connections",
  "ai-models",
  "partner",
  "transcribe",
  "narration",
  "quality",
  "notifications",
  "tools",
  "shortcuts",
  "storage",
  "privacy",
  "statistics",
  "help",
  "about",
  "developer",
  "listening"
] as const;
export const JEV_COMMAND_VALUE_SCHEMAS = {
  "akari.catalog.setMaterialFilter": {
    "type": "object",
    "properties": {
      "kind": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "video",
            "audio",
            "image",
            "other",
            "3d"
          ]
        },
        "maxItems": 5
      }
    },
    "required": [
      "kind"
    ],
    "additionalProperties": false
  },
  "akari.catalog.setMaterialSort": {
    "type": "object",
    "properties": {
      "by": {
        "type": "string",
        "enum": [
          "name",
          "duration",
          "created"
        ]
      },
      "order": {
        "type": "string",
        "enum": [
          "asc",
          "desc"
        ]
      }
    },
    "required": [
      "by",
      "order"
    ],
    "additionalProperties": false
  },
  "akari.catalog.setMaterialQuery": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "maxLength": 512
      }
    },
    "required": [
      "query"
    ],
    "additionalProperties": false
  },
  "akari.library.setFilter": {
    "type": "object",
    "properties": {
      "source": {
        "type": "string",
        "enum": [
          "all",
          "own",
          "site",
          "lab"
        ]
      },
      "price": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "free",
            "premium",
            "purchased"
          ]
        },
        "maxItems": 3
      },
      "license": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "commercial",
            "attribution",
            "noncommercial"
          ]
        },
        "maxItems": 3
      },
      "status": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "cached",
            "remote",
            "favorite"
          ]
        },
        "maxItems": 3
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "akari.catalog.clearFilters": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "akari.settings.setByVoice": {
    "type": "object",
    "properties": {
      "key": {
        "type": "string",
        "enum": [
          "appearance.zoom",
          "appearance.themeMode",
          "timeline.visualThumbnails",
          "timeline.trackRippleDisplay"
        ]
      },
      "value": {
        "type": [
          "number",
          "string",
          "boolean"
        ]
      }
    },
    "required": [
      "key",
      "value"
    ],
    "additionalProperties": false
  }
} as Record<string, import('./jev-catalog-validate').JevValueSchema>;
