import { INSPECTOR_ADJUST_BASIC_FIELDS } from './adjust-fields';
import { INSPECTOR_ADJUST_WHEELS } from './adjust-editor-model';

export interface InspectorLookPreset {
    id: string; name: string;
    adjust: { basic?: Record<string, number>; wheels?: Record<string, { r?: number; g?: number; b?: number }> };
}

export const INSPECTOR_LOOK_PRESETS: readonly InspectorLookPreset[] = [
    {
        "id": "teal_orange",
        "name": "ティール＆オレンジ",
        "adjust": {
            "basic": {
                "contrast": 0.15,
                "saturation": 0.2,
                "temperature": 0.05
            },
            "wheels": {
                "gamma": {
                    "r": -0.05,
                    "g": -0.02,
                    "b": 0.05
                },
                "gain": {
                    "r": 0.08,
                    "g": -0.02,
                    "b": -0.08
                }
            }
        }
    },
    {
        "id": "golden_hour",
        "name": "ゴールデンアワー",
        "adjust": {
            "basic": {
                "exposure": 0.15,
                "contrast": 0.1,
                "saturation": 0.15,
                "temperature": 0.2,
                "tint": 0.05
            },
            "wheels": {
                "gamma": {
                    "r": 0.05,
                    "g": 0.02,
                    "b": -0.05
                },
                "gain": {
                    "r": 0.1,
                    "g": 0.05,
                    "b": -0.1
                },
                "offset": {
                    "r": 0.02,
                    "b": -0.02
                }
            }
        }
    },
    {
        "id": "filmic_fade",
        "name": "フィルミックフェード",
        "adjust": {
            "basic": {
                "exposure": -0.15,
                "contrast": 0.05,
                "saturation": -0.1
            },
            "wheels": {
                "lift": {
                    "r": 0.05,
                    "g": 0.03,
                    "b": 0.02
                },
                "gain": {
                    "r": -0.05,
                    "g": -0.03,
                    "b": -0.02
                },
                "offset": {
                    "r": 0.03,
                    "g": 0.02,
                    "b": 0.01
                }
            }
        }
    },
    {
        "id": "clean_punch",
        "name": "クリーンパンチ",
        "adjust": {
            "basic": {
                "exposure": 0.15,
                "contrast": 0.3,
                "saturation": 0.1,
                "temperature": -0.05
            },
            "wheels": {
                "gain": {
                    "r": 0.05,
                    "g": 0.05,
                    "b": 0.05
                }
            }
        }
    },
    {
        "id": "bleach",
        "name": "ブリーチバイパス",
        "adjust": {
            "basic": {
                "contrast": 0.4,
                "saturation": -0.4
            },
            "wheels": {
                "gamma": {
                    "r": -0.05,
                    "g": -0.05,
                    "b": -0.05
                },
                "gain": {
                    "r": 0.1,
                    "g": 0.1,
                    "b": 0.1
                }
            }
        }
    },
    {
        "id": "noir_soft",
        "name": "ソフトノワール",
        "adjust": {
            "basic": {
                "contrast": 0.2,
                "saturation": -0.8
            },
            "wheels": {
                "lift": {
                    "r": 0.03,
                    "g": 0.03,
                    "b": 0.03
                },
                "gamma": {
                    "r": -0.03,
                    "g": -0.03,
                    "b": -0.03
                }
            }
        }
    },
    {
        "id": "cool_matte",
        "name": "クールマット",
        "adjust": {
            "basic": {
                "exposure": -0.15,
                "contrast": 0.05,
                "saturation": -0.1,
                "temperature": -0.15
            },
            "wheels": {
                "lift": {
                    "r": 0.03,
                    "g": 0.03,
                    "b": 0.05
                },
                "gamma": {
                    "b": 0.02
                },
                "gain": {
                    "r": -0.05,
                    "g": -0.03
                },
                "offset": {
                    "r": 0.01,
                    "g": 0.01,
                    "b": 0.02
                }
            }
        }
    },
    {
        "id": "vivid_summer",
        "name": "ビビッドサマー",
        "adjust": {
            "basic": {
                "exposure": 0.15,
                "contrast": 0.1,
                "saturation": 0.3,
                "temperature": 0.1,
                "tint": -0.05
            },
            "wheels": {
                "gain": {
                    "r": 0.05,
                    "g": 0.05,
                    "b": -0.05
                }
            }
        }
    }
];

export function matchLookPreset(adjust: unknown): string | undefined {
    const record = (v: unknown): Record<string, unknown> =>
        v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
    const input = record(adjust);
    const equal = (a: unknown, b: unknown): boolean =>
        typeof (a ?? 0) === 'number' && Math.abs(Number(a ?? 0) - Number(b ?? 0)) <= 1e-6;
    return INSPECTOR_LOOK_PRESETS.find(preset =>
        INSPECTOR_ADJUST_BASIC_FIELDS.every(({ key }) => equal(record(input.basic)[key], preset.adjust.basic?.[key]))
        && INSPECTOR_ADJUST_WHEELS.every(({ key }) => ['r', 'g', 'b'].every(ch =>
            equal(record(record(input.wheels)[key])[ch], record(preset.adjust.wheels?.[key])[ch]))))?.id;
}
