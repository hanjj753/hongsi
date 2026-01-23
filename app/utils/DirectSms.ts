// utils/DirectSms.ts
import { NativeModules } from 'react-native';

const { DirectSms } = NativeModules;

interface DirectSmsInterface {
  sendDirectSms(phoneNumber: string, msg: string): void;
}

export default DirectSms as DirectSmsInterface;