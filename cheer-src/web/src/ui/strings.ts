// 화면 문구는 모두 여기에 모은다. 한국어 '~해요' 체, 짧고 부드럽게.
// 고궁 공간에서 영어를 함께 보여줄 때는 이 객체를 언어별로 나누면 된다.
export const S = {
  actions: {
    group: '동작',
    key: (n: number) => `숫자 ${n}키`,
    greeting: '가까운 사람에게 알려요',
  },
  joystick: {
    // 휴대폰 왼쪽 아래 조이스틱 (터치 기기에서만 보인다)
    label: '이동 조이스틱',
    roleDescription: '조이스틱',
    hint: '끌어서 걸어요',
  },
  settings: {
    open: '설정 열기',
    title: '설정',
    close: '설정 닫기',
    tabsLabel: '설정 구역',
    tabs: { sound: '소리', controls: '조작', motion: '움직임' },
  },
  sound: {
    ambient: { label: '환경음', hint: '주막에 깔린 사람들 말소리예요' },
    shared: { label: '공동 소리', hint: '골이나 킥오프처럼 모두가 함께 듣는 소리예요' },
    effects: { label: '효과음', hint: '박수, 건배, 주문 소리예요' },
    volume: (label: string) => `${label} 크기`,
    percent: (v: number) => `${v}%`,
    noFiles: '이 층에는 아직 소리가 없어요',
    locked: '화면을 한 번 누르면 소리가 나기 시작해요',
    unsupported: '이 브라우저에서는 소리를 켤 수 없어요',
    startsOff: '화면을 한 번 누르면 소리가 켜져요. 여기서 끄거나 크기를 줄일 수 있어요',
    keepPlaying: { label: '다른 탭에서도 계속 듣기', hint: '끄면 다른 탭으로 갈 때 소리가 멈춰요' },
    /** 설정 버튼 왼쪽의 스피커 버튼 (누른 상태 = 모두 끔) */
    muteAll: '소리 모두 끄기',
    mutedNote: '소리를 모두 꺼 두었어요. 오른쪽 위 스피커 버튼으로 다시 켤 수 있어요',
  },
  controls: {
    title: '조작 방법',
    desktop: '컴퓨터',
    phone: '휴대폰',
    rows: {
      desktop: [
        { how: ['바닥 누르기'], what: '그곳까지 걸어가요' },
        { how: ['방석 누르기'], what: '걸어가서 앉아요' },
        { how: ['W', 'A', 'S', 'D'], also: ['↑', '←', '↓', '→'], what: '걸어 다녀요' },
        { how: ['끌기'], what: '둘러봐요' },
        { how: ['휠'], what: '가까이, 또는 멀리 봐요' },
        { how: ['1', '2', '3'], what: '박수, 건배, 주문을 해요' },
      ],
      phone: [
        { how: ['왼쪽 아래 조이스틱'], what: '끌어서 걸어 다녀요' },
        { how: ['누르기'], what: '바닥이나 방석까지 걸어가요' },
        { how: ['끌기'], what: '둘러봐요' },
        { how: ['두 손가락 벌리기'], what: '가까이 봐요' },
        { how: ['두 손가락 오므리기'], what: '멀리 봐요' },
        { how: ['오른쪽 아래 버튼'], what: '박수, 건배, 주문을 해요' },
      ],
    },
  },
  motion: {
    title: '움직임 줄이기',
    intro: '카메라 흔들림과 큰 움직임을 줄여요',
    group: '움직임 줄이기 선택',
    system: { label: '기기 설정 따르기', hint: '기기의 동작 줄이기 설정을 그대로 따라요' },
    on: { label: '켜기', hint: '언제나 움직임을 줄여요' },
    off: { label: '끄기', hint: '기기 설정과 상관없이 평소처럼 보여줘요' },
    nowOn: '지금은 움직임이 줄어든 상태예요',
    nowOff: '지금은 평소처럼 움직여요',
  },
  loading: {
    progress: '불러오는 중',
    preparing: '장면을 준비하고 있어요',
    ready: '준비됐어요',
    failed: '장면을 불러오지 못했어요',
    retry: '다시 해볼게요',
    toyHint: (label: string) => `${label}, 눌러서 놀아요`,
  },
  net: {
    // 왼쪽 위 알약: 몇 명이 같이 응원 중인지, 연결이 어떤지
    people: (n: number) => `${n}명 응원 중`,
    connecting: '연결하는 중이에요',
    solo: '혼자 응원 중',
    reconnecting: '다시 연결하는 중이에요',
    full: '자리가 다 찼어요',
    denied: '지금은 들어갈 수 없어요',
    replaced: '다른 창에서 열려 있어요',
    // 설정 창 위쪽 이름
    todayName: (name: string) => `오늘의 이름: ${name}`,
  },
  cheer: {
    close: '닫기',
  },
  notice: {
    // 서버가 알려 준 인사: "OO님이 ~했어요". 뒷부분은 동작의 notice 문구나 이름표로 만든다
    greeted: (name: string, phrase: string) => `${name}님이 ${phrase}`,
    greetedFallback: (name: string) => `${name}님이 인사를 건넸어요`,
    seatTaken: '이미 누가 앉아 있어요',
    seatFailed: '지금은 앉을 수 없어요',
    dailyLimit: '오늘 건넬 수 있는 만큼 다 건넸어요',
    roomFullMove: (rec: number) => `이 방은 자리가 다 찼어요. ${rec}번 방으로 옮길게요`,
    roomFullWait: '주막이 꽉 찼어요. 잠시 후 다시 들어와 주세요',
    denied: '지금은 들어갈 수 없어요',
  },
} as const;
