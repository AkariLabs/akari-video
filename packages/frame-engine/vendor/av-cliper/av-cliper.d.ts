import { file } from 'opfs-tools';
import { Log } from '@webav/internal-utils';
import { MP4Sample } from '@webav/mp4box.js';

declare type AnimateImgType = 'avif' | 'webp' | 'png' | 'gif';

/**
 * 音频素材，为创建、编辑音视频功能提供音频数据
 *
 * @example
 * new AudioClip((await fetch('<mp3 url>')).body, {
 *   loop: true,
 * }),
 */
export declare class AudioClip implements IClip {
    #private;
    static ctx: AudioContext | null;
    ready: IClip['ready'];
    /**
     * 音频元信息
     *
     * ⚠️ 注意，这里是转换后（标准化）的元信息，非原始音频元信息
     */
    get meta(): {
        sampleRate: 48000;
        chanCount: number;
        duration: number;
        width: number;
        height: number;
    };
    /**
     * 获取音频素材完整的 PCM 数据
     */
    getPCMData(): Float32Array[];
    /**
     *
     * @param dataSource 音频文件流
     * @param opts 音频配置，控制音量、是否循环
     */
    constructor(dataSource: ReadableStream<Uint8Array> | Float32Array[], opts?: IAudioClipOpts);
    /**
     * 拦截 {@link AudioClip.tick} 方法返回的数据，用于对音频数据二次处理
     * @param time 调用 tick 的时间
     * @param tickRet tick 返回的数据
     *
     * @see [移除视频绿幕背景](https://webav-tech.github.io/WebAV/demo/3_2-chromakey-video)
     */
    tickInterceptor: <T extends Awaited<ReturnType<AudioClip['tick']>>>(time: number, tickRet: T) => Promise<T>;
    /**
     * 返回上次与当前时刻差对应的音频 PCM 数据；
     *
     * 若差值超过 3s 或当前时间小于上次时间，则重置状态
     * @example
     * tick(0) // => []
     * tick(1e6) // => [leftChanPCM(1s), rightChanPCM(1s)]
     *
     */
    tick(time: number): Promise<{
        audio: Float32Array[];
        state: 'success' | 'done';
    }>;
    /**
     * 按指定时间切割，返回前后两个音频素材
     * @param time 时间，单位微秒
     */
    split(time: number): Promise<[this, this]>;
    clone(): Promise<this>;
    /**
     * 销毁实例，释放资源
     */
    destroy(): void;
    static concatAudioClip: typeof concatAudioClip;
}

/**
 * Sprite 基类
 *
 * @see {@link OffscreenSprite}
 * @see {@link VisibleSprite}
 */
declare abstract class BaseSprite {
    #private;
    /**
     * 控制素材在视频中的空间属性（坐标、旋转、缩放）
     */
    rect: Rect;
    get time(): {
        offset: number;
        duration: number;
        playbackRate: number;
    };
    set time(v: {
        offset: number;
        duration: number;
        playbackRate?: number;
    });
    /**
     * 监听属性变更事件
     * @example
     * sprite.on('propsChange', (changedProps) => {})
     */
    on: <Type extends "propsChange">(type: Type, listener: {
        propsChange: (value: Partial<{
            rect: Partial<Rect>;
            zIndex: number;
        }>) => void;
    }[Type]) => (() => void);
    get zIndex(): number;
    /**
     * 控制素材间的层级关系，zIndex 值较小的素材会被遮挡
     */
    set zIndex(v: number);
    /**
     * 不透明度
     */
    opacity: number;
    /**
     * 水平或垂直方向翻转素材
     */
    flip: 'horizontal' | 'vertical' | null;
    /**
     * @see {@link IClip.ready}
     */
    ready: Promise<void>;
    constructor();
    protected _render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void;
    /**
     * 给素材添加动画，使用方法参考 css animation
     *
     * @example
     * sprite.setAnimation(
     *   {
     *     '0%': { x: 0, y: 0 },
     *     '25%': { x: 1200, y: 680 },
     *     '50%': { x: 1200, y: 0 },
     *     '75%': { x: 0, y: 680 },
     *     '100%': { x: 0, y: 0 },
     *   },
     *   { duration: 4e6, iterCount: 1 },
     * );
     *
     * @see [视频水印动画](https://webav-tech.github.io/WebAV/demo/2_1-concat-video)
     */
    setAnimation(keyFrame: TKeyFrameOpts, opts: IAnimationOpts): void;
    /**
     * 如果当前 sprite 已被设置动画，将 sprite 的动画属性设定到指定时间的状态
     */
    animate(time: number): void;
    /**
     * 将当前 sprite 的属性赋值到目标
     *
     * 用于 clone，或 {@link VisibleSprite} 与 {@link OffscreenSprite} 实例间的类型转换
     */
    copyStateTo<T extends BaseSprite>(target: T): void;
    protected destroy(): void;
}

/**
 * 视频合成器；能添加多个 {@link OffscreenSprite}，根据它们位置、层级、时间偏移等信息，合成输出为视频文件
 * @see [视频合成](https://webav-tech.github.io/WebAV/demo/2_1-concat-video)
 * @see [视频配音](https://webav-tech.github.io/WebAV/demo/2_2-video-add-audio)
 * @example
 * const spr1 = new OffscreenSprite(
 *   new MP4Clip((await fetch('<mp4 url>')).body),
 * );
 * const spr2 = new OffscreenSprite(
 *   new AudioClip((await fetch('<audio url>')).body),
 * );
 * const com = new Combinator({ width: 1280, height: 720, });

 * await com.addSprite(spr1);
 * await com.addSprite(spr2);

 * com.output(); // => ReadableStream
 *
 */
export declare class Combinator {
    #private;
    /**
     * 检测当前环境的兼容性
     * @param args.videoCodec 指定视频编码格式，默认 avc1.42E032
     * @param args.width 指定视频宽度，默认 1920
     * @param args.height 指定视频高度，默认 1080
     * @param args.bitrate 指定视频比特率，默认 5e6
     */
    static isSupported(args?: {
        videoCodec?: string;
        width?: number;
        height?: number;
        bitrate?: number;
    }): Promise<boolean>;
    on: <Type extends "error" | "OutputProgress">(type: Type, listener: {
        OutputProgress: (progress: number) => void;
        error: (err: Error) => void;
    }[Type]) => (() => void);
    /**
     * 根据配置创建合成器实例
     * @param opts ICombinatorOpts
     */
    constructor(opts?: ICombinatorOpts);
    /**
     * 添加用于合成视频的 Sprite，视频时长默认取所有素材 duration 字段的最大值
     * @param os Sprite
     * @param opts.main 如果 main 为 true，视频时长为该素材的 duration 值
     */
    addSprite(os: OffscreenSprite, opts?: {
        main?: boolean;
    }): Promise<void>;
    /**
     * 输出视频文件二进制流
     * @param opts.maxTime 允许输出视频的最大时长，超过时长的素材内容会被忽略
     */
    output(opts?: {
        maxTime?: number;
    }): ReadableStream<Uint8Array>;
    /**
     * 销毁实例，释放资源
     */
    destroy(): void;
}

/**
 * 拼接多个 AudioClip
 */
declare function concatAudioClip(clips: AudioClip[], opts?: IAudioClipOpts): Promise<AudioClip>;

/**
 * 绿幕抠图
 * keyColor 需要扣除的背景色，若不传则取第一个像素点
 * similarity 背景色相似度阈值，过小可能保留背景色，过大可能扣掉更多非背景像素点
 * smoothness 平滑度；过小可能出现锯齿，过大导致整体变透明
 * spill      饱和度；过小可能保留绿色混合，过大导致图片变灰度
 * @param opts: {
 *   keyColor?: [r, g, b]
 *   similarity: number
 *   smoothness: number
 *   spill: number
 * }
 */
export declare const createChromakey: (opts: Omit<IChromakeyOpts, "keyColor"> & {
    keyColor?: [number, number, number];
}) => (imgSource: TImgSource) => Promise<ImageBitmap | VideoFrame>;

/**
 * 嵌入式字幕，将字幕（目前仅支持 SRT 格式）嵌入视频画面中
 *
 * @example
 * const es = new EmbedSubtitlesClip(srtSubtitleStr, {
 *   videoWidth: 1280,
 *   videoHeight: 720,
 *   fontFamily: 'Noto Sans SC',
 *   color: 'white',
 * });
 */
export declare class EmbedSubtitlesClip implements IClip {
    #private;
    ready: IClip['ready'];
    get meta(): {
        width: number;
        height: number;
        duration: number;
    };
    constructor(content: string | SubtitleStruct[], opts: IEmbedSubtitlesOpts);
    /**
     * @see {@link IClip.tick}
     */
    tick(time: number): Promise<{
        video?: VideoFrame;
        state: 'done' | 'success';
    }>;
    /**
     * @see {@link IClip.split}
     */
    split(time: number): Promise<[this, this]>;
    /**
     * @see {@link IClip.clone}
     */
    clone(): Promise<this>;
    /**
     * @see {@link IClip.destroy}
     */
    destroy(): void;
}

declare type ExtMP4Sample = Omit<MP4Sample, 'data'> & {
    is_idr: boolean;
    deleted?: boolean;
    data: null | Uint8Array;
};

/**
 * 快速拼接多个mp4 文件流，要求所有 mp4 的属性一致，
 * 属性包括（不限于）：音视频编码格式、分辨率、采样率
 *
 * @param streams 一个包含 Uint8Array 的可读流数组。
 * @returns 返回一个 Promise，该 Promise 在解析时返回一个包含合并后的 MP4 数据的可读流。
 * @throws 如果无法从流生成文件，将抛出错误。
 *
 * @example
 * const streams = [stream1, stream2, stream3];
 * const resultStream = await fastConcatMP4(streams);
 */
export declare function fastConcatMP4(streams: ReadableStream<Uint8Array>[]): Promise<ReadableStream<Uint8Array>>;

/**
 * 为 WebAV 生成的 fmp4 文件设置正确的时长值
 */
export declare function fixFMP4Duration(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>>;

declare interface IAnimationOpts {
    duration: number;
    delay?: number;
    iterCount?: number;
}

declare interface IAudioClipOpts {
    loop?: boolean;
    volume?: number;
}

declare interface IChromakeyOpts {
    keyColor: [number, number, number];
    similarity: number;
    smoothness: number;
    spill: number;
}

/**
 * 所有素材需要实现的接口
 *
 * 素材（Clip）是不同数据类型的抽象，给其他模块提供数据
 *
 * WebAV 内置了 {@link MP4Clip}, {@link AudioClip}, {@link ImgClip}, {@link MediaStreamClip} 等常用素材，用于给 {@link Combinator} {@link AVCanvas} 提供数据
 *
 * 你只需实现该接口即可自定义素材，拥有最大的灵活度来生成视频内容，比如动画、转场效果等
 * @see [自定义素材](https://webav-tech.github.io/WebAV/demo/2_6-custom-clip)
 *
 */
export declare interface IClip {
    /**
     * 从素材中提取指定时间数据
     * @param time 时间，单位 微秒
     */
    tick: (time: number) => Promise<{
        video?: VideoFrame | ImageBitmap | null;
        audio?: Float32Array[];
        state: 'done' | 'success';
    }>;
    /**
     * 当素材准备完成，ready 会切换到 resolved 状态
     */
    readonly ready: Promise<IClipMeta>;
    /**
     * 数据元数据
     */
    readonly meta: IClipMeta;
    /**
     * clone，返回一个新素材
     */
    clone: () => Promise<this>;
    /**
     * 按指定时间切割，返回该时刻前后两个新素材，常用于剪辑场景按时间分割素材
     *
     * 该方法不会破坏原素材的数据
     *
     * @param time 时间，微秒
     * @returns
     */
    split?: (time: number) => Promise<[this, this]>;
    /**
     * 销毁实例，释放资源
     */
    destroy: () => void;
}

declare interface IClipMeta {
    width: number;
    height: number;
    duration: number;
}

export declare interface ICombinatorOpts {
    width?: number;
    height?: number;
    bitrate?: number;
    fps?: number;
    bgColor?: string;
    videoCodec?: string;
    /**
     * false 合成的视频文件中排除音轨
     */
    audio?: false;
    /**
     * 向输出的视频中写入 meta tags 数据
     */
    metaDataTags?: Record<string, string>;
    /**
     * 不安全，随时可能废弃
     */
    __unsafe_hardwareAcceleration__?: HardwarePreference;
}

declare interface IEmbedSubtitlesOpts {
    color?: string;
    textBgColor?: string | null;
    type?: 'srt';
    fontFamily?: string;
    fontSize?: number;
    letterSpacing?: string | null;
    bottomOffset?: number;
    strokeStyle?: string;
    lineWidth?: number | null;
    lineCap?: CanvasLineCap | null;
    lineJoin?: CanvasLineJoin | null;
    textShadow?: {
        offsetX: number;
        offsetY: number;
        blur: number;
        color: string;
    };
    videoWidth: number;
    videoHeight: number;
    fontWeight?: string | number;
    fontStyle?: 'normal' | 'italic';
}

/**
 * 图像素材，支持动图
 *
 * 普通文字可通过 {@link renderTxt2ImgBitmap} 转换成图片素材
 *
 * @example
 * new ImgClip((await fetch('<img url>')).body);
 *
 * @example
 * new ImgClip(
 *   await renderTxt2ImgBitmap(
 *     '水印',
 *    `font-size:40px; color: white; text-shadow: 2px 2px 6px red;`,
 *   )
 * )
 *
 * @see [视频合成](https://webav-tech.github.io/WebAV/demo/2_1-concat-video)
 */
export declare class ImgClip implements IClip {
    #private;
    ready: IClip['ready'];
    /**
     * ⚠️ 静态图片的 duration 为 Infinity
     *
     * 使用 Sprite 包装时需要将它的 duration 设置为有限数
     *
     */
    get meta(): {
        duration: number;
        width: number;
        height: number;
    };
    /**
     * 静态图片可使用流、ImageBitmap 初始化
     *
     * 动图需要使用 VideoFrame[] 或提供图片类型
     */
    constructor(dataSource: ReadableStream | ImageBitmap | VideoFrame[] | {
        type: `image/${AnimateImgType}`;
        stream: ReadableStream;
    });
    tickInterceptor: <T extends Awaited<ReturnType<ImgClip['tick']>>>(time: number, tickRet: T) => Promise<T>;
    tick(time: number): Promise<{
        video: ImageBitmap | VideoFrame;
        state: 'success';
    }>;
    split(time: number): Promise<[this, this]>;
    clone(): Promise<this>;
    destroy(): void;
}

export declare interface IMP4ClipOpts {
    audio?: boolean | {
        volume: number;
    };
    /**
     * 不安全，随时可能废弃
     */
    __unsafe_hardwareAcceleration__?: HardwarePreference;
}

declare interface IPoint {
    x: number;
    y: number;
}

declare interface IRectBaseProps {
    x: number;
    y: number;
    w: number;
    h: number;
    angle: number;
}

export { Log }

/**
 * 包装实时音视频流，仅用于 [AVCanvas](../../av-canvas/classes/AVCanvas.html)
 *
 * ⚠️ 不可用于 {@link Combinator} ，因为后台合成视频的速度是快于物理时间的，实时流无法提供非实时的数据
 *
 * @example
 * const spr = new VisibleSprite(
 *   new MediaStreamClip(
 *     await navigator.mediaDevices.getUserMedia({ video: true, audio: true, }),
 *   ),
 * );
 * await avCvs.addSprite(spr);
 */
export declare class MediaStreamClip implements IClip {
    #private;
    static ctx: AudioContext | null;
    ready: IClip['ready'];
    get meta(): {
        duration: number;
        width: number;
        height: number;
    };
    /**
     * 实时流的音轨
     */
    readonly audioTrack: MediaStreamAudioTrack | null;
    constructor(ms: MediaStream);
    tick(): Promise<{
        video: ImageBitmap | null;
        audio: Float32Array[];
        state: 'success';
    }>;
    split(): Promise<[this, this]>;
    clone(): Promise<this>;
    destroy(): void;
}

/**
 * 视频配音；混合 MP4 与音频文件，仅重编码音频，视频轨道不变
 * @param mp4Stream - MP4 流
 * @param audio - 音频信息
 * @param audio.stream - 音频数据流
 * @param audio.volume - 音频音量
 * @param audio.loop - 音频时长小于视频时，是否循环使用音频流
 * @returns 输出混合后的音频流
 */
export declare function mixinMP4AndAudio(mp4Stream: ReadableStream<Uint8Array>, audio: {
    stream: ReadableStream<Uint8Array>;
    volume: number;
    loop: boolean;
}): ReadableStream<Uint8Array<ArrayBufferLike>>;

/**
 * MP4 素材，解析 MP4 文件，使用 {@link MP4Clip.tick} 按需解码指定时间的图像帧
 *
 * 可用于实现视频抽帧、生成缩略图、视频编辑等功能
 *
 * @example
 * new MP4Clip((await fetch('<mp4 url>')).body)
 * new MP4Clip(mp4File.stream())
 *
 * @see {@link Combinator}
 * @see [AVCanvas](../../av-canvas/classes/AVCanvas.html)
 *
 * @see [解码播放视频](https://webav-tech.github.io/WebAV/demo/1_1-decode-video)
 */
export declare class MP4Clip implements IClip {
    #private;
    ready: IClip['ready'];
    get meta(): {
        duration: number;
        width: number;
        height: number;
        audioSampleRate: number;
        audioChanCount: number;
    };
    /**
     * 提供视频头（box: ftyp, moov）的二进制数据
     * 使用任意 mp4 demxer 解析即可获得详细的视频信息
     * 单元测试包含使用 mp4box.js 解析示例代码
     */
    getFileHeaderBinData(): Promise<ArrayBuffer>;
    constructor(source: OPFSToolFile | ReadableStream<Uint8Array> | MPClipCloneArgs, opts?: IMP4ClipOpts);
    /**
     * 拦截 {@link MP4Clip.tick} 方法返回的数据，用于对图像、音频数据二次处理
     * @param time 调用 tick 的时间
     * @param tickRet tick 返回的数据
     *
     * @see [移除视频绿幕背景](https://webav-tech.github.io/WebAV/demo/3_2-chromakey-video)
     */
    tickInterceptor: <T extends Awaited<ReturnType<MP4Clip['tick']>>>(time: number, tickRet: T) => Promise<T>;
    /**
     * 获取素材指定时刻的图像帧、音频数据
     * @param time 微秒
     */
    tick(time: number): Promise<{
        video?: VideoFrame;
        audio: Float32Array[];
        state: 'success' | 'done';
    }>;
    /**
     * 生成缩略图，默认每个关键帧生成一个 100px 宽度的缩略图。
     *
     * @param imgWidth 缩略图宽度，默认 100
     * @param opts Partial<ThumbnailOpts>
     * @returns Promise<Array<{ ts: number; img: Blob }>>
     */
    thumbnails(imgWidth?: number, opts?: Partial<ThumbnailOpts>): Promise<Array<{
        ts: number;
        img: Blob;
    }>>;
    split(time: number): Promise<[this, this]>;
    clone(): Promise<this>;
    /**
     * 拆分 MP4Clip 为仅包含视频轨道和音频轨道的 MP4Clip
     * @returns Mp4CLip[]
     */
    splitTrack(): Promise<MP4Clip[]>;
    destroy(): void;
}

declare interface MP4DecoderConf {
    video: VideoDecoderConfig | null;
    audio: AudioDecoderConfig | null;
}

declare function mp4FileToSamples(otFile: OPFSToolFile, opts?: IMP4ClipOpts): Promise<{
    videoSamples: ExtMP4Sample[];
    audioSamples: ExtMP4Sample[];
    decoderConf: MP4DecoderConf;
    headerBoxPos: {
        start: number;
        size: number;
    }[];
    parsedMatrix: {
        perspective: number;
        rotationRad: number;
        rotationDeg: number;
        scaleX: number;
        scaleY: number;
        translateX: number;
        translateY: number;
    };
}>;

declare type MPClipCloneArgs = Awaited<ReturnType<typeof mp4FileToSamples>> & {
    localFile: OPFSToolFile;
};

/**
 * 包装 {@link IClip} 给素材扩展坐标、层级、透明度等信息，用于 {@link Combinator} 在后台合成视频
 *
 * 跟 {@link VisibleSprite} 非常相似，应用场景不同
 *
 * @example
 * const spr = new OffscreenSprite(
 *   new MP4Clip((await fetch('<mp4 url>')).body),
 * );
 * spr.opacity = 0.5 // 半透明
 * spr.rect.x = 100 // x 坐标偏移 100 像素
 * spr.time.offset = 10e6 // 视频第 10s 开始绘制该视频素材
 *
 * @see [视频合成](https://webav-tech.github.io/WebAV/demo/2_1-concat-video)
 */
export declare class OffscreenSprite extends BaseSprite {
    #private;
    constructor(clip: IClip);
    /**
     * 绘制素材指定时刻的图像到 canvas 上下文，并返回对应的音频数据
     * @param time 指定时刻，微秒
     */
    offscreenRender(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, time: number): Promise<{
        audio: Float32Array[];
        done: boolean;
    }>;
    clone(): Promise<OffscreenSprite>;
    destroy(): void;
}

declare type OPFSToolFile = ReturnType<typeof file>;

/**
 * 用于记录素材在视频或画布中的空间属性：位置、大小、旋转
 *
 * 并提供控制点位置，支持用户在画布中缩放、旋转素材
 *
 * 一般由内部 WebAV SDK 内部创建维护
 *
 * @see {@link Combinator}, {@link OffscreenSprite}
 * @see [AVCanvas](../../av-canvas/classes/AVCanvas.html), {@link VisibleSprite}
 *
 * @see [视频剪辑](https://webav-tech.github.io/WebAV/demo/6_4-video-editor)
 */
export declare class Rect implements IRectBaseProps {
    #private;
    /**
     * 监听属性变更事件
     * @example
     * rect.on('propsChange', (changedProps) => {})
     */
    on: <Type extends "propsChange">(type: Type, listener: {
        propsChange: (props: Partial<IRectBaseProps>) => void;
    }[Type]) => (() => void);
    /**
     * x 坐标
     */
    get x(): number;
    set x(v: number);
    get y(): number;
    /**
     * y 坐标
     */
    set y(v: number);
    /**
     * 宽
     */
    get w(): number;
    set w(v: number);
    /**
     * 高
     */
    get h(): number;
    set h(v: number);
    /**
     * 旋转角度
     * @see [MDN Canvas rotate](https://developer.mozilla.org/docs/Web/API/CanvasRenderingContext2D/rotate)
     */
    get angle(): number;
    set angle(v: number);
    constructor(x?: number, y?: number, w?: number, h?: number, master?: Rect | null);
    /**
     * 根据坐标、宽高计算出来的矩形中心点
     */
    get center(): IPoint;
    /**
     * 是否保持固定宽高比例，禁止变形缩放
     *
     * 值为 true 时，将缺少上下左右四个控制点
     */
    fixedAspectRatio: boolean;
    /**
     * 是否固定中心点进行缩放
     * 值为 true 时，固定中心点不变进行缩放
     * 值为 false 时，固定对角点不变进行缩放
     */
    fixedScaleCenter: boolean;
    clone(): Rect;
    /**
     * 检测目标坐标是否命中当前实例
     * @param tx 目标点 x 坐标
     * @param ty 目标点 y 坐标
     */
    checkHit(tx: number, ty: number): boolean;
}

/**
 * 将文本渲染为 {@link ImageBitmap}，用来创建 {@link ImgClip}
 * @param txt - 要渲染的文本
 * @param cssText - 应用于文本的 CSS 样式
 * @param opts - 选项
 * @param opts.font -  自定义字体
 * @param opts.onCreated - 创建完成后的回调
 *
 * @example
 * new ImgClip(
 *   await renderTxt2ImgBitmap(
 *     '水印',
 *    `font-size:40px; color: white; text-shadow: 2px 2px 6px red; font-family: CustomFont;`,
 *    {
 *      font: {
 *        name: 'CustomFont',
 *        url: '/CustomFont.ttf',
 *      },
 *    },
 *   )
 * )
 */
export declare function renderTxt2ImgBitmap(txt: string, cssText: string, opts?: {
    font?: {
        name: string;
        url: string;
    };
    onCreated?: (el: HTMLElement) => void;
}): Promise<ImageBitmap>;

declare interface SubtitleStruct {
    start: number;
    end: number;
    text: string;
}

declare type TAnimateProps = IRectBaseProps & {
    opacity: number;
};

declare type ThumbnailOpts = {
    start: number;
    end: number;
    step: number;
};

declare type TImgSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas | VideoFrame;

declare type TKeyFrameOpts = Partial<Record<`${number}%` | 'from' | 'to', Partial<TAnimateProps>>>;

/**
 * 包装 {@link IClip} 给素材扩展坐标、层级、透明度等信息，用于 {@link [AVCanvas](../../av-canvas/classes/AVCanvas.html)} 响应用户交互
 *
 * 跟 {@link OffscreenSprite} 非常相似，应用场景不同
 *
 * @example
 * const spr = new VisibleSprite(
 *   new MP4Clip((await fetch('<mp4 url>')).body),
 * );
 * spr.opacity = 0.5 // 半透明
 * spr.rect.x = 100 // x 坐标偏移 100 像素
 * spr.time.offset = 10e6 // 视频第 10s 开始绘制素材
 *
 * @see [视频剪辑](https://webav-tech.github.io/WebAV/demo/6_4-video-editor)
 *
 */
export declare class VisibleSprite extends BaseSprite {
    #private;
    getClip(): IClip;
    /**
     * 元素是否可见，用于不想删除，期望临时隐藏 Sprite 的场景
     */
    visible: boolean;
    /**
     * 控制 Sprite 的交互状态
     * - 'interactive': 可选中，可进行移动、缩放、旋转等所有交互
     * - 'selectable': 仅可选中，但不可进行移动、缩放、旋转等交互
     * - 'disabled': 不可选中，也不可交互
     * @default 'interactive'
     */
    interactable: 'interactive' | 'selectable' | 'disabled';
    constructor(clip: IClip);
    /**
     * 提前准备指定 time 的帧
     */
    preFrame(time: number): Promise<void>;
    /**
     * 绘制素材指定时刻的图像到 canvas 上下文，并返回对应的音频数据
     * @param time 指定时刻，微秒
     */
    render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, time: number): {
        audio: Float32Array[];
    };
    copyStateTo<T extends BaseSprite>(target: T): void;
    destroy(): void;
}

export { }
