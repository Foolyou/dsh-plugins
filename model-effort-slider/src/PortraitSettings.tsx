import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ACCEPTED_TYPES, MAX_PORTRAITS, portraitStore, preparePortrait, usePortraits } from './portraits';

export function PortraitSettings() {
  const { portraits, error: storageError } = usePortraits();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const inputId = useId(), helpId = useId();
  useEffect(() => () => upload.current?.abort(), []);
  useLayoutEffect(() => { if (restoreFocus.current) { restoreFocus.current = false; input.current?.focus(); } }, [portraits]);
  async function add(files: File[]) {
    if (!files.length || upload.current) return;
    setError(null); setStatus('');
    const previous = portraitStore.getSnapshot().portraits;
    if (files.length + previous.length > MAX_PORTRAITS) { setError('最多保存六张图片，请减少所选文件或先移除已有图片。'); return; }
    const controller = new AbortController(); upload.current = controller; setBusy(true);
    try {
      // Sequential decode bounds memory use. A failed batch does not partially save.
      const prepared: string[] = [];
      for (const file of files) prepared.push(await preparePortrait(file, controller.signal));
      if (controller.signal.aborted) return;
      if (portraitStore.getSnapshot().portraits !== previous) throw new Error('图片已在其他页面更改，请重新选择文件。');
      if (portraitStore.save([...previous, ...prepared])) setStatus(`已保存 ${prepared.length} 张图片。`);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) { setBusy(false); upload.current = null; }
    }
  }
  function save(next: readonly string[], notice: string, focusInput = false) {
    setError(null); setStatus('');
    if (portraitStore.save(next)) { setStatus(notice); restoreFocus.current = focusInput; }
  }
  function move(index: number, delta: number) {
    const next = [...portraits];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    save(next, `图片 ${index + 1} 已移至位置 ${index + delta + 1}。`);
  }
  return <section className="mes-settings" aria-label="推理滑块图片" aria-busy={busy}>
    <h2>推理滑块图片</h2>
    <p>未提供图片时只显示轨道和节点，不显示图片框或倒三角。可手动选择最多六张任意内容的图片，按顺序从最低到最高推理等级均匀映射；只有一张时所有等级使用该图片。图片不改变模型或推理参数。</p>
    <p id={helpId}>仅支持 PNG、JPEG、WebP，每张不超过 2 MiB，宽高不超过 4096 像素。图片会居中裁剪为 160 × 160 的静态预览。只保存在此浏览器的本站本地存储中，不上传到服务器、不写入仓库、不随账号同步。清除站点数据会移除图片。</p>
    <label htmlFor={inputId}>添加图片（{portraits.length} / {MAX_PORTRAITS}）</label>
    <input ref={input} id={inputId} type="file" accept={ACCEPTED_TYPES.join(',')} multiple disabled={busy || portraits.length >= MAX_PORTRAITS} aria-describedby={helpId}
      onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void add(files); }} />
    {portraits.length === 0 ? <p className="mes-settings-empty">未设置图片：使用纯色滑块。</p> : <ol className="mes-portraits" aria-label="图片顺序（低到高）">
      {portraits.map((src, index) => <li key={index}>
        <img src={src} alt={`图片 ${index + 1} 预览`} width={72} height={72} />
        <span>位置 {index + 1}</span>
        <div className="mes-portrait-actions">
          <button type="button" disabled={busy || index === 0} aria-label={`前移图片 ${index + 1}`} onClick={() => move(index, -1)}>前移</button>
          <button type="button" disabled={busy || index === portraits.length - 1} aria-label={`后移图片 ${index + 1}`} onClick={() => move(index, 1)}>后移</button>
          <button type="button" disabled={busy} aria-label={`移除图片 ${index + 1}`} onClick={() => save(portraits.filter((_, i) => i !== index), `已移除图片 ${index + 1}。`, true)}>移除</button>
        </div>
      </li>)}
    </ol>}
    <button type="button" disabled={busy || (!portraits.length && !storageError)} onClick={() => save([], '已恢复纯色滑块并清除本地图片。', true)}>重置为纯色滑块</button>
    {(error || storageError) && <p className="mes-error" role="alert">{error || storageError}</p>}
    <p role="status" aria-live="polite">{busy ? '正在本地处理图片…' : status}</p>
  </section>;
}
