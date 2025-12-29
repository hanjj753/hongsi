import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Alert, Platform, TouchableOpacity } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

const TARGET_FOLDER_NAME = "김연주쌤 과학"

export default function FilesScreen() {
  const router = useRouter();

  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<{id: string, name : string}[]>([]);
  const [isTargetMissing, setIsTargetMissing] = useState(false);

  useEffect(() => {
    findTargetFolder();
  }, []);

  const getAccessToken = async () => {
    if (Platform.OS === 'web') {
      const token = localStorage.getItem('google_access_token');
      if (!token) throw new Error('인증 토큰이 없습니다. 다시 로그인해주세요.');
      return token;
    } else {
      const tokens = await GoogleSignin.getTokens();
      return tokens.accessToken;
    }
  };

  const findTargetFolder = async () => {
    setLoading(true);
    setErrorMsg(null);
    setIsTargetMissing(false);

    try {
      const token = await getAccessToken();
      const query = `name = '${TARGET_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and starred = true and trashed = false`;

      const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const result = await response.json();

      if(result.error) { throwResultError(result.error); }

      if (result.files && result.files.length > 0) {
        const targetId = result.files[0].id;
        setCurrentFolderId(targetId);
        fetchFilesInside(targetId, token);
      } else {
        setIsTargetMissing(true);
        setLoading(false);
      }
    } catch(error : any) {
      handleError(error);
    } 
  };

  const fetchFilesInside = async (folderId:string, token?: string) => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const accessToken = token || await getAccessToken();
    }
  }

  const renderItem = ({item} : {item : any}) => {
    const isFolder = item.mimeType === 'application/vnd.google-apps.folder';

    return (
      <View style={styles.fileItem}>
        <Ionicons
          name={isFolder ? "folder" : "document-text"}
          size={30}
          color={isFolder ? "#FBBC04" : "#4285F4"}
          style={{marginRight : 15}}
        />
        <View style={{flex : 1}}>
          <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.fileType}>{isFolder ? "폴더" : "파일"}</Text>
        </View>
      </View>
    )
  }

  if (errorMsg) {
    return (
      <View style={styles.container}>
        <Text style={styles.headerTitle}>내 드라이브</Text>
        <View style={styles.centerView}>
          <Ionicons name="alert-circle-outline" size={50} color="#FF5A5F" />
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDriveFiles}>
            <Text style={styles.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
  <View style={styles.container}>
    <Text style={styles.headerTitle}>내 드라이브</Text>

    {loading ? (
      <ActivityIndicator size="large" color="#4285F4" style={{marginTop : 20}}/>
    ) : (
      <FlatList
        data={files}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.emptyText}>파일이 없습니다.</Text>}
        contentContainerStyle={{paddingBottom : 20 }}
      />
    )}

    <TouchableOpacity style={styles.refreshButton} onPress={fetchDriveFiles}>
      <Ionicons name="refresh" size={24} color="white" />
    </TouchableOpacity>
  </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  centerView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  fileName: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  fileType: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 50,
    color: '#aaa',
  },
  errorText: {
    color: '#FF5A5F',
    marginTop: 10,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  retryText: {
    color: 'white',
    fontWeight: 'bold',
  },
  refreshButton: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    backgroundColor: '#4285F4',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  }
});