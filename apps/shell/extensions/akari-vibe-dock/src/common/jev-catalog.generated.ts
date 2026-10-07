// 自動生成・編集しない・再生成は npm run gen:jev
export type JevValueSchema = {
    type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | ('number' | 'string' | 'boolean')[];
    enum?: (string | number | boolean)[];
    items?: JevValueSchema;
    maxItems?: number;
    maxLength?: number;
    pattern?: string;
    minimum?: number;
    exclusiveMinimum?: number;
    required?: string[];
    properties?: Record<string, JevValueSchema>;
    additionalProperties?: false;
};

export function validateValue(schema: JevValueSchema, value: unknown): boolean {
    if (!schema || typeof schema !== 'object') return false;
    if (schema.enum && !schema.enum.includes(value as never)) return false;
    if (Array.isArray(schema.type)) return schema.type.some(type => validateValue({ ...schema, type }, value));
    switch (schema.type) {
        case 'string': return typeof value === 'string' && (schema.maxLength === undefined || value.length <= schema.maxLength)
            && (schema.pattern === undefined || new RegExp(schema.pattern).test(value));
        case 'number':
        case 'integer': return typeof value === 'number' && Number.isFinite(value)
            && (schema.type !== 'integer' || Number.isInteger(value))
            && (schema.minimum === undefined || value >= schema.minimum)
            && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum);
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value) && (schema.maxItems === undefined || value.length <= schema.maxItems)
            && (!schema.items || value.every(item => validateValue(schema.items as JevValueSchema, item)));
        case 'object': {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            const props = schema.properties ?? {};
            if ((schema.required ?? []).some(key => !Object.prototype.hasOwnProperty.call(value, key))) return false;
            return Object.entries(value).every(([key, item]) =>
                Object.prototype.hasOwnProperty.call(props, key) ? validateValue(props[key], item) : schema.additionalProperties !== false);
        }
        default: return false;
    }
}

export const JEV_LOCAL_ACTIONS = [
  {
    "id": "A1",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
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
    "commands": [
      {
        "commandId": "akari.catalog.setMaterialFilter"
      }
    ]
  },
  {
    "id": "A2",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
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
    "commands": [
      {
        "commandId": "akari.catalog.setMaterialSort"
      }
    ]
  },
  {
    "id": "A3",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
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
    "commands": [
      {
        "commandId": "akari.catalog.setMaterialQuery"
      }
    ]
  },
  {
    "id": "A4",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "type": "string",
          "enum": [
            "library"
          ]
        },
        "category": {
          "type": "string",
          "maxLength": 512
        },
        "query": {
          "type": "string",
          "maxLength": 512
        }
      },
      "required": [
        "tab",
        "query"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.catalog.open"
      }
    ]
  },
  {
    "id": "A5",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
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
    "commands": [
      {
        "commandId": "akari.library.setFilter"
      }
    ]
  },
  {
    "id": "A6",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "type": "string",
          "enum": [
            "library"
          ]
        },
        "category": {
          "type": "string",
          "maxLength": 512
        }
      },
      "required": [
        "tab",
        "category"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.catalog.open"
      }
    ]
  },
  {
    "id": "A7",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.catalog.clearFilters"
      }
    ]
  },
  {
    "id": "A8",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "type": "string",
          "enum": [
            "project",
            "library"
          ]
        }
      },
      "required": [
        "tab"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.catalog.open"
      }
    ]
  },
  {
    "id": "B1",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "itemId": {
          "type": "string",
          "maxLength": 512
        },
        "seek": {
          "type": "boolean"
        },
        "pulse": {
          "type": "boolean"
        }
      },
      "required": [
        "itemId"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.timeline.focusItem"
      }
    ]
  },
  {
    "id": "B2",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "captionId": {
          "type": "string",
          "maxLength": 512
        },
        "pulse": {
          "type": "boolean"
        }
      },
      "required": [
        "captionId"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.daihon.open"
      }
    ]
  },
  {
    "id": "B3",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "seconds": {
          "type": "number"
        }
      },
      "required": [
        "seconds"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.timeline.seek",
        "argsMap": {
          "seconds": "value.seconds"
        }
      },
      {
        "commandId": "akari.preview.seekOutput",
        "argsMap": {
          "time": "value.seconds"
        }
      }
    ]
  },
  {
    "id": "B4",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "editUri": {
          "type": "string",
          "maxLength": 512
        }
      },
      "required": [
        "editUri"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.preview.play"
      }
    ]
  },
  {
    "id": "B4.zoom",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "editUri": {
          "type": "string",
          "maxLength": 512
        },
        "scale": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "editUri",
        "scale"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.preview.setViewZoom"
      }
    ]
  },
  {
    "id": "B4.setLoop",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "editUri": {
          "type": "string",
          "maxLength": 512
        },
        "startSeconds": {
          "type": "number"
        },
        "endSeconds": {
          "type": "number"
        }
      },
      "required": [
        "editUri",
        "startSeconds",
        "endSeconds"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.preview.setLoopRange"
      }
    ]
  },
  {
    "id": "B4.setRate",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "editUri": {
          "type": "string",
          "maxLength": 512
        },
        "rate": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "editUri",
        "rate"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.preview.setPlaybackRate"
      }
    ]
  },
  {
    "id": "B4.pause",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "editUri": {
          "type": "string",
          "maxLength": 512
        }
      },
      "required": [
        "editUri"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.preview.pause"
      }
    ]
  },
  {
    "id": "B5",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "fit": {
          "type": "boolean"
        }
      },
      "required": [
        "fit"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.timeline.setView"
      }
    ]
  },
  {
    "id": "B6",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "type": "string",
          "enum": [
            "library"
          ]
        },
        "assetId": {
          "type": "string",
          "maxLength": 512
        },
        "pulse": {
          "type": "boolean"
        }
      },
      "required": [
        "tab",
        "assetId"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.catalog.open"
      }
    ]
  },
  {
    "id": "C1",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.inspector.open"
      }
    ]
  },
  {
    "id": "C1.review",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.review.open"
      }
    ]
  },
  {
    "id": "C1.timeline",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.timeline.reveal"
      }
    ]
  },
  {
    "id": "C1.cuts",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.cuts.open"
      }
    ]
  },
  {
    "id": "C1.daihon",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.daihon.open"
      }
    ]
  },
  {
    "id": "C3",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "section": {
          "type": "string",
          "maxLength": 64
        }
      },
      "required": [
        "section"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.settings.open"
      }
    ]
  },
  {
    "id": "C4",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.open"
      }
    ]
  },
  {
    "id": "D1",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
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
    },
    "commands": [
      {
        "commandId": "akari.settings.setByVoice"
      }
    ]
  },
  {
    "id": "roughCanvas.open",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.open"
      }
    ]
  },
  {
    "id": "roughCanvas.close",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.close"
      }
    ]
  },
  {
    "id": "roughCanvas.next",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.next"
      }
    ]
  },
  {
    "id": "roughCanvas.backdrop",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.backdrop"
      }
    ]
  },
  {
    "id": "roughCanvas.tool",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string",
          "enum": [
            "select",
            "pen",
            "arrow",
            "text"
          ]
        }
      },
      "required": [
        "tool"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.tool"
      }
    ]
  },
  {
    "id": "roughCanvas.deleteSelected",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.deleteSelected"
      }
    ]
  },
  {
    "id": "roughCanvas.submit",
    "tierMax": 2,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "task",
            "send"
          ]
        }
      },
      "required": [
        "mode"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.sketch.submit"
      }
    ]
  },
  {
    "id": "browser.search",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "engine": {
          "type": "string",
          "maxLength": 64,
          "pattern": "^[a-z0-9-]{1,64}$"
        },
        "query": {
          "type": "string",
          "maxLength": 512
        }
      },
      "required": [
        "engine",
        "query"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.browser.search"
      }
    ]
  },
  {
    "id": "browser.pickMode",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {
        "on": {
          "type": "boolean"
        }
      },
      "required": [
        "on"
      ],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.browser.pickMode"
      }
    ]
  },
  {
    "id": "browser.close",
    "tierMax": 1,
    "reversible": "yes",
    "valueSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "commands": [
      {
        "commandId": "akari.browser.close"
      }
    ]
  }
] as const;
