// utils/googleSheet.js
// 수업생성시트에서 데이터 가져와서 class와 연결하는 util 함수들

const CLASS_SCRIPT_URL = 'REMOVED_PRIVATE_SCRIPT_URL';
const ID_HEADER = 'ID';
const SHEET_URL_HEADER = '시트 URL';
const MASTER_URL_HEADER = '마스터 시트 URL';

/**
 * 1. 구글 시트 전체 데이터 가져오기 (GET)
 * @param {string} url - 배포된 구글 스크립트 웹 앱 URL
 * @returns {Promise<Array>} 데이터 리스트 (JSON 객체 배열)
 */
export const fetchSheetData = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Network response was not ok');
    return await response.json();
  } catch (error) {
    console.error('[Fetch Error]: ', error);
    throw error;
  }
};

/**
 * 2. 구글 시트에 데이터 추가하기 (POST)
 * @param {string} url - 배포된 구글 스크립트 웹 앱 URL
 * @param {Object} data - 추가할 데이터 객체
 */
export const postSheetData = async (url, data) => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'text/plain;charset=utf-8', // GAS 호환성 유지
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Network response was not ok');
    return await response.json();
  } catch (error) {
    console.error('[Post Error]: ', error);
    throw error;
  }
};

/**
 * 3. 특정 ID에 해당하는 시트 URL(M열)과 마스터 시트 URL(N열) 가져오기
 * @param {string} targetId - 찾고자 하는 ID (A열의 값)
 * @param {string} url - 데이터를 조회할 스크립트 URL
 * @returns {Promise<Object|null>} { sheetUrl, masterUrl } 형태 또는 못 찾으면 null
 */
export const getClassUrls = async (targetId, url = CLASS_SCRIPT_URL) => {
  try {
    // 1. 전체 데이터를 가져옵니다.
    const allData = await fetchSheetData(url);
    
    // 2. A열(ID)이 targetId와 일치하는 행을 찾습니다.
    const foundRow = allData.find(row => row[ID_HEADER] == targetId); 

    if (foundRow) {
      return {
        // M열의 헤더 이름을 키값으로 사용
        sheetUrl: foundRow[SHEET_URL_HEADER], 
        // N열의 헤더 이름을 키값으로 사용
        masterUrl: foundRow[MASTER_URL_HEADER]  
      };
    }
    
    return null; // 찾는 ID가 없을 경우
  } catch (error) {
    console.error('[getClassUrls Error]: ', error);
    throw error;
  }
};

