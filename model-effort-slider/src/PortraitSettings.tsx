import { useEffect, useId, useRef, useState } from 'react';
import { MAX_ADD_BATCH, ACCEPTED_TYPES } from './protocol';
import { portraitStore, usePortraits } from './portraits';

/** Settings surface for the host-stored portrait list. */
export function PortraitSettings() {
  const { portraits, error: storageError, hostAvailable, busy } = usePortraits();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState(false);
  const upload = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId(), helpId = useId();
  useEffect(() => () => upload.current?.abort(), []);
  const working = busy > 0;

  async function add(files: File[]) {
    if (!files.length || upload.current) return;
    setError(null); setStatus('');
    if (files.length > MAX_ADD_BATCH) { setError(`每次最多上传 ${MAX_ADD_BATCH} 张图片，请分批添加。`); return; }
    const controller = new AbortController(); upload.current = controller; setUploading(true);
    try {
      const before = portraitStore.getSnapshot().portraits.length;
      await portraitStore.add(files);
      const snapshot = portraitStore.getSnapshot();
      if (!snapshot.error) setStatus(`已保存 ${snapshot.portraits.length - before} 张图片。`);
    } finally {
      if (!controller.signal.aborted) { setUploading(false); upload.current = null; }
    }
  }

  async function run(task: () => Promise<void>) {
    setError(null); setStatus('');
    await task();
  }

  return <section className="mes-settings" aria-label="推理滑块图片" aria-busy={working}>
    <h2>推理滑块图片</h2>
    <p>未提供图片时只显示轨道和节点，不显示图片框或倒三角。可添加任意数量的图片，按顺序从最低到最高推理等级均匀映射；只有一张时所有等级使用该图片。图片不改变模型或推理参数。</p>
    <p id={helpId}>仅支持 PNG、JPEG、WebP，每张不超过 2 MiB，宽高不超过 4096 像素。图片会居中裁剪为 160 × 160 的 PNG 并由宿主端保存到 DSH 数据目录，因此同一 DSH 的所有浏览器都能看到，也不会随浏览器站点数据被清除。</p>
    <label htmlFor={inputId}>添加图片（当前 {portraits.length} 张）</label>
    <input ref={input} id={inputId} type="file" accept={ACCEPTED_TYPES.join(',')} multiple disabled={!hostAvailable || working} aria-describedby={helpId}
      onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void add(files); }} />
    {portraits.length === 0 ? <p className="mes-settings-empty">未设置图片：使用纯色滑块。</p> : <ol className="mes-portraits" aria-label="图片顺序（低到高）">
      {portraits.map((info, index) => <li key={info.id}>
        <img src={info.url} alt={`图片 ${index + 1} 预览`} width={72} height={72} />
        <span>位置 {index + 1}</span>
        <div className="mes-portrait-actions">
          <button type="button" disabled={working || index === 0} aria-label={`前移图片 ${index + 1}`} onClick={() => void run(() => portraitStore.move(info.id, -1))}>前移</button>
          <button type="button" disabled={working || index === portraits.length - 1} aria-label={`后移图片 ${index + 1}`} onClick={() => void run(() => portraitStore.move(info.id, 1))}>后移</button>
          <button type="button" disabled={working} aria-label={`移除图片 ${index + 1}`} onClick={() => void run(() => portraitStore.remove(info.id))}>移除</button>
        </div>
      </li>)}
    </ol>}
    <button type="button" disabled={working || !portraits.length} onClick={() => void run(() => portraitStore.reset())}>重置为纯色滑块</button>
    {(error || storageError) && <p className="mes-error" role="alert">{error || storageError}</p>}
    <p role="status" aria-live="polite">{working || uploading ? '正在处理图片…' : status}</p>
  </section>;
}
