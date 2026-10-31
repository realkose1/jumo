// 선수 사진: 주모 앱이 쓰는 같은 사진(주모 웹의 /image/*.png, 얼굴과 어깨 헤드샷)을 TV에 쓴다.
// 응원 주막(/cheer/)과 같은 주소에서 오므로 캔버스에 그려도 텍스처가 막히지 않는다.

/** 선수 이름 -> 사진 파일 (주모 앱 index.html의 PlayerPhoto와 같은 목록) */
export const PLAYER_PHOTO_FILES: Readonly<Record<string, string>> = {
  손흥민: 'heungmin.png',
  이강인: 'kangin.png',
  김민재: 'minjae.png',
  조규성: 'guesung.png',
  황희찬: 'heechan.png',
  황인범: 'inbeom.png',
  김하성: 'haseong.png',
  이정후: 'junghoo.png',
  김혜성: 'hyeseong.png',
  오현규: 'hyungyu.png',
  양현준: 'hyunjun.png',
  백승호: 'seungho.png',
  배준호: 'junho.png',
  엄지성: 'jisung.png',
  설영우: 'youngwoo.png',
  이한범: 'hanbeom.png',
  이재성: 'jaesung.png',
  홍현석: 'hyunseok.png',
  정우영: 'wooyeong.png',
  카스트로프: 'castrop.png',
  박승수: 'seungsoo.png',
  김지수: 'jisoo.png',
  양민혁: 'minhyeok.png',
  이태석: 'taeseok.png',
  김민수: 'minsu.png',
  김예건: 'yegeon.png',
  송성문: 'songsm.png',
};

/** 사진 주소. 주모 웹 뿌리의 /image/ 아래. 없는 선수면 null */
export function playerPhotoUrl(name: string): string | null {
  const file = PLAYER_PHOTO_FILES[name.trim()];
  return file ? `/image/${file}` : null;
}

type Entry = { img: HTMLImageElement; ok: boolean; failed: boolean };
const cache = new Map<string, Entry>();

/**
 * 캔버스에 그릴 선수 사진. 처음 부르면 불러오기 시작하고, 다 오기 전이나 사진이 없으면 null.
 * onReady는 다 불러왔을 때 불린다(다시 그리기용).
 */
export function playerPhoto(name: string, onReady?: () => void): HTMLImageElement | null {
  const url = playerPhotoUrl(name);
  if (!url || typeof Image === 'undefined') return null;
  let e = cache.get(url);
  if (!e) {
    const img = new Image();
    img.decoding = 'async';
    const entry: Entry = { img, ok: false, failed: false };
    img.onload = () => {
      entry.ok = img.naturalWidth > 0;
      onReady?.();
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = url;
    cache.set(url, entry);
    e = entry;
  }
  return e.ok ? e.img : null;
}
