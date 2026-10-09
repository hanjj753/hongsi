// SMS 전송을 위한 네이티브 모듈 인터페이스 정의 및 내보내기
import { NativeModules } from 'react-native';

// 네이티브 모듈에서 가져오기
const { DirectSms } = NativeModules;

/**
 * 네이티브 모듈(Java/Swift)의 함수 타입을 정의합니다.
 */
interface DirectSmsInterface {
  /**
   * 사용자의 개입 없이 백그라운드에서 SMS를 바로 전송합니다.
   * (주의: 안드로이드 권한 필요, iOS에서는 작동 방식이 다를 수 있음)
   * * @param phoneNumber - 수신자 전화번호
   * @param msg - 보낼 메시지 내용
   */
  sendDirectSms(phoneNumber: string, msg: string): Promise<void>;
}

// 타입 단언(Type Assertion)을 통해 내보냅니다.
export default DirectSms as DirectSmsInterface;