export declare function elementAxes(center: {x:number;y:number}, xProbe:{x:number;y:number}, yProbe:{x:number;y:number}): {x:{x:number;y:number};y:{x:number;y:number}};
export declare function elementPoint(geometry: any, horizontal:number, vertical:number): {x:number;y:number};
export declare function elementHandlePoints(geometry:any, name:string): {dragged:{x:number;y:number};anchor:{x:number;y:number};signs:number[]} | null;
export declare function elementBoxSize(width:number, height:number, name:string, delta:{x:number;y:number}, shift:boolean): {width:number;height:number};
export declare function elementLocalDelta(screen:{x:number;y:number}, axes:any): {x:number;y:number};
export declare function elementAngle(value:number, shift:boolean): number;
export declare function elementHandleLayout(width:number, height:number): {hideHorizontalEdges:boolean;hideVerticalEdges:boolean;outsideX:boolean;outsideY:boolean;cornerOffsetX:number;cornerOffsetY:number;rotateTop:number};
export declare function elementBoxCompanions(style:CSSStyleDeclaration, parentStyle:CSSStyleDeclaration | null, width:number | null, height:number | null): Record<string,string>;
