import React, { useState, useEffect, useRef, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { 
  MapPin, AlertTriangle, Activity, Battery, Clock, User, Mail, 
  Shield, Users, LogOut, Navigation, Phone, MessageCircle, Calendar, Bell, Check,
  Send, X, Plus, Settings, ChevronRight
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Supabase設定
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

console.log(' Family Safe - Initializing...');
console.log(' Supabase URL:', supabaseUrl);
console.log(' Anon Key exists:', !!supabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ ERROR: Supabase credentials missing!');
  alert('エラー: Supabase設定が見つかりません。.envファイルを確認してください。');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'family-safe-auth-v1',
  },
  global: {
    headers: {
      'x-application-name': 'family-safe'
    }
  }
});

console.log('✅ Supabase client created successfully');

const App = () => {
  // State管理
  const [currentView, setCurrentView] = useState('login');
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [groupMessages, setGroupMessages] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState(100);
  const watchIdRef = useRef(null);
  const loadingRef = useRef(false);
  const batteryIntervalRef = useRef(null);

  const updateOnlineStatus = async (status) => {
    if (!currentUser?.id) return;
    
    try {
      await supabase
        .from('user_presence')
        .upsert({
          user_id: currentUser.id,
          status: status,
          last_seen: new Date().toISOString()
        });
    } catch (error) {
      console.error('Update presence error:', error);
    }
  };

    // URLハッシュを見て初期画面を決める（QRコード読み取り対応）
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#register') {
      setCurrentView('register');
      // ハッシュを消しておく（ブラウザバック対策）
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;

    // ログイン時にオンライン状態にする
    updateOnlineStatus('online');

    // 定期的にハートビートを送る（5秒ごと）
    const heartbeatInterval = setInterval(() => {
      updateOnlineStatus('online');
    }, 5000);

    // ページを離れる時にオフラインにする
    const handleBeforeUnload = () => {
      navigator.sendBeacon(
        `${supabaseUrl}/rest/v1/user_presence`,
        JSON.stringify({
          user_id: currentUser.id,
          status: 'offline',
          last_seen: new Date().toISOString()
        })
      );
    };

    // タブを切り替えた時
    const handleVisibilityChange = () => {
      if (document.hidden) {
        updateOnlineStatus('offline');
      } else {
        updateOnlineStatus('online');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(heartbeatInterval);
      updateOnlineStatus('offline');
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.id]);

// 通知権限をリクエスト
useEffect(() => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      console.log('Notification permission:', permission);
    });
  }
}, []);

  // Battery API監視
  useEffect(() => {
    const updateBattery = async () => {
      if ('getBattery' in navigator) {
        try {
          const battery = await navigator.getBattery();
          const level = Math.round(battery.level * 100);
          setBatteryLevel(level);
          
          if (currentUser?.role === 'child') {
            const myProfile = members.find(m => m.userId === currentUser.id);
            if (myProfile) {
              await supabase
                .from('members')
                .update({ battery: level })
                .eq('id', myProfile.id);
            }
          }
        } catch (error) {
          console.error('Battery API error:', error);
        }
      }
    };

    updateBattery();
    batteryIntervalRef.current = setInterval(updateBattery, 60000);

    return () => {
      if (batteryIntervalRef.current) {
        clearInterval(batteryIntervalRef.current);
      }
    };
  }, [currentUser, members]);

  // 認証状態の監視
  useEffect(() => {
    let isMounted = true;
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && isMounted) {
        loadUserProfile(session.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      
      if (session) {
        loadUserProfile(session.user);
      } else {
        setCurrentUser(null);
        setCurrentView('login');
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ユーザープロフィール読み込み
const loadUserProfile = async (authUser) => {
  if (loadingRef.current) return;
  loadingRef.current = true;
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (data) {
      const user = {
        id: data.id,
        email: authUser.email,
        name: data.name,
        role: data.role,
        phone: data.phone,
        avatar: data.role === 'parent' ? 'P' : 'C',
        avatar_url: data.avatar_url
      };
      setCurrentUser(user);
      setCurrentView(user.role === 'parent' ? 'parent-dashboard' : 'child-dashboard');
      
      if (user.role === 'parent') {
        await loadMembersData(user);
        await loadAlerts(user);
      } else if (user.role === 'child') {
        await loadMembersData(user);
      }
    } else {
      setCurrentUser({ 
        id: authUser.id, 
        email: authUser.email,
        isNewUser: true 
      });
      setCurrentView('role-selection');
    }
  } catch (error) {
    console.error('Profile load error:', error);
    
    if (error.code === 'PGRST116') {
      setCurrentUser({ 
        id: authUser.id, 
        email: authUser.email,
        isNewUser: true 
      });
      setCurrentView('role-selection');
    }
  } finally {
    loadingRef.current = false;
  }
};

// メンバーデータ読み込み
const loadMembersData = async (user) => {
  if (!user || dataLoading) return;
  
  setDataLoading(true);
  
  try {
    if (user.role === 'parent') {
  const { data: relationships, error: relError } = await supabase
    .from('parent_children')
    .select('child_id')
    .eq('parent_id', user.id);

  if (relError) {
    console.error('Relationship error:', relError);
    setMembers([]);
    setDataLoading(false);
    return;
  }

  if (!relationships || relationships.length === 0) {
    setMembers([]);
    setDataLoading(false);
    return;
  }

  const childIds = relationships.map(r => r.child_id);

  const { data, error: memberError } = await supabase
    .from('members')
    .select('*')
    .in('user_id', childIds);

  if (memberError) {
    console.error('Members error:', memberError);
    setMembers([]);
    setDataLoading(false);
    return;
  }

  if (data && data.length > 0) {
    const profileIds = data.map(m => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, avatar_url')  // ⭐ avatar_urlを追加
      .in('id', profileIds);
    
    const profileMap = {};
    if (profiles) {
      profiles.forEach(p => {
        profileMap[p.id] = { 
          name: p.name,
          avatarUrl: p.avatar_url  // ⭐ 追加
        };
      });
    }

    const formattedMembers = data.map(m => ({
      id: m.id,
      userId: m.user_id,
      name: profileMap[m.user_id]?.name || m.name,
      avatar: 'C',
      avatarUrl: profileMap[m.user_id]?.avatarUrl,  // ⭐ 追加
      status: m.status || 'safe',
      location: { 
        lat: m.latitude || 35.6812, 
        lng: m.longitude || 139.7671, 
        address: m.address || '位置情報未取得' 
      },
      battery: m.battery || 100,
      lastUpdate: new Date(m.last_update || Date.now()),
      isMoving: m.gps_enabled || false,
      gpsActive: m.gps_enabled || false,
      locationHistory: [],
      schedule: [],
      destination: null
    }));
    
    setMembers(formattedMembers);
    
    await Promise.all(
      formattedMembers.map(member => 
        Promise.all([
          loadSchedules(member.id),
          loadDestination(member.id),
          loadActivityHistory(member.id)
        ])
      )
    );
  } else {
    setMembers([]);
  }
} else if (user.role === 'child') {
      console.log('[CHILD] Loading member data for user:', user.id);
      
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('user_id', user.id);

      console.log('[CHILD] Query result:', { data, error });

      if (error) {
        console.error('[CHILD] Load error:', error);
      }

      if (data && data.length > 0) {
        console.log('[CHILD] Found existing member:', data[0]);
        const memberData = data[0];
        const myProfile = {
          id: memberData.id,
          userId: memberData.user_id,
          name: user.name,
          avatar: 'C',
          status: memberData.status || 'safe',
          location: { 
            lat: memberData.latitude || 35.6812, 
            lng: memberData.longitude || 139.7671, 
            address: memberData.address || '位置情報未取得' 
          },
          battery: memberData.battery || 100,
          lastUpdate: new Date(memberData.last_update || Date.now()),
          isMoving: memberData.gps_enabled || false,
          gpsActive: memberData.gps_enabled || false,
          locationHistory: [],
          schedule: [],
          destination: null
        };
        setMembers([myProfile]);
        setGpsEnabled(memberData.gps_enabled || false);
        
        await Promise.all([
          loadSchedules(myProfile.id),
          loadDestination(myProfile.id),
          loadActivityHistory(myProfile.id)
        ]);
      } else {
        console.log('[CHILD] No member found, creating new one...');
        
        try {
          const { data: newMember, error: insertError } = await supabase
            .from('members')
            .insert([{
              user_id: user.id,
              name: user.name,
              status: 'safe',
              battery: batteryLevel,
              gps_enabled: false,
              latitude: 35.6812,
              longitude: 139.7671,
              address: '位置情報未取得',
              last_update: new Date().toISOString()
            }])
            .select()
            .single();

          if (insertError) {
            console.error('[CHILD] Insert error:', insertError);
            alert('メンバーレコードの作成に失敗しました: ' + insertError.message);
            setMembers([]);
            setDataLoading(false);
            return;
          }

          console.log('[CHILD] New member created:', newMember);

          if (newMember) {
            const myProfile = {
              id: newMember.id,
              userId: newMember.user_id,
              name: user.name,
              avatar: 'C',
              status: 'safe',
              location: { 
                lat: 35.6812, 
                lng: 139.7671, 
                address: '位置情報未取得' 
              },
              battery: batteryLevel,
              lastUpdate: new Date(),
              isMoving: false,
              gpsActive: false,
              locationHistory: [],
              schedule: [],
              destination: null
            };
            setMembers([myProfile]);
            console.log('[CHILD] Member state updated');
          }
        } catch (createError) {
          console.error('[CHILD] Exception:', createError);
          alert('メンバー作成中にエラーが発生しました: ' + createError.message);
          setMembers([]);
        }
      }
    }
  } catch (error) {
    console.error('[ERROR] Load members failed:', error);
    setMembers([]);
  } finally {
    setDataLoading(false);
  }
};

  // スケジュール読み込み
  const loadSchedules = async (memberId) => {
    try {
      const { data } = await supabase
        .from('schedules')
        .select('*')
        .eq('member_id', memberId)
        .eq('date', new Date().toISOString().split('T')[0])
        .order('time', { ascending: true });
      
      if (data) {
        setMembers(prev => prev.map(m => 
          m.id === memberId ? { ...m, schedule: data } : m
        ));
      }
    } catch (error) {
      console.error('Load schedules error:', error);
    }
  };

  // 目的地読み込み
  const loadDestination = async (memberId) => {
    try {
      const { data, error } = await supabase
        .from('destinations')
        .select('*')
        .eq('member_id', memberId)
        .eq('is_active', true);
      
      if (!error && data && data.length > 0) {
        setMembers(prev => prev.map(m => 
          m.id === memberId ? {
            ...m,
            destination: {
              name: data[0].name,
              lat: data[0].latitude,
              lng: data[0].longitude,
              category: data[0].category
            }
          } : m
        ));
      }
    } catch (error) {
      console.error('Load destination error:', error);
    }
  };


// 活動履歴読み込み（created_at版）
const loadActivityHistory = async (memberId) => {
  try {
    const { data, error } = await supabase
      .from('location_history')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) {
      console.error('Load activity history error:', error);
      return;
    }
    
    console.log('Activity history loaded:', data);
    
    if (data) {
      setMembers(prev => prev.map(m => 
        m.id === memberId ? { 
          ...m, 
          locationHistory: data.map(h => ({
            address: h.address,
            lat: h.latitude,
            lng: h.longitude,
            timestamp: h.created_at
          }))
        } : m
      ));
    }
  } catch (error) {
    console.error('Load activity history error:', error);
  }
};

// アラート読み込み
const loadAlerts = async (user) => {
  if (user.role !== 'parent') return;
  
  try {
    console.log('Loading alerts for parent:', user.id);
    
    // 自分の子供のIDを取得
    const { data: relationships, error: relError } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_id', user.id);
    
    if (relError) {
      console.error('Relationship error:', relError);
      return;
    }
    
    console.log('Child relationships:', relationships);
    
    if (!relationships || relationships.length === 0) {
      console.log('No children found');
      setAlerts([]);
      return;
    }
    
    const childIds = relationships.map(r => r.child_id);
    
    // 子供のmember_idを取得
    const { data: membersData, error: memberError } = await supabase
      .from('members')
      .select('id, user_id')
      .in('user_id', childIds);
    
    if (memberError) {
      console.error('Members error:', memberError);
      return;
    }
    
    console.log('Members data:', membersData);
    
    if (!membersData || membersData.length === 0) {
      console.log('No members found');
      setAlerts([]);
      return;
    }
    
    const memberIds = membersData.map(m => m.id);
    console.log('Member IDs:', memberIds);
    
    // アラートを取得
    const { data: alertsData, error: alertError } = await supabase
      .from('alerts')
      .select('*')
      .in('member_id', memberIds)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (alertError) {
      console.error('Alerts error:', alertError);
      return;
    }
    
    console.log('Alerts loaded:', alertsData);
    
    if (alertsData) {
      setAlerts(alertsData.map(a => ({
        id: a.id,
        type: a.type,
        memberId: a.member_id,
        message: a.message,
        timestamp: new Date(a.created_at),
        read: a.read || false
      })));
    }
  } catch (error) {
    console.error('Load alerts error:', error);
  }
};

// メッセージのリアルタイム購読（親側） - App.jsxのトップレベル（Appコンポーネント内）
useEffect(() => {
  if (!currentUser) return;
  
  const channel = supabase
    .channel('parent-messages')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `to_user_id=eq.${currentUser.id}`
      },
      async (payload) => {
        console.log('Parent received message:', payload.new);
        
        // 送信者の名前を取得
        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', payload.new.from_user_id)
          .single();
        
        const senderName = senderProfile?.name || '不明';
        
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) {
            return prev;
          }
          return [...prev, {
            id: payload.new.id,
            from: payload.new.from_user_id,
            to: payload.new.to_user_id,
            text: payload.new.text,
            timestamp: new Date(payload.new.created_at),
            read: payload.new.read
          }];
        });
        
        // 通知を表示
        if (Notification.permission === 'granted') {
          const notification = new Notification('Family Safe - 新着メッセージ', {
            body: `${senderName}: ${payload.new.text}`,
            icon: '/favicon.ico',
            tag: 'message-' + payload.new.id,
            requireInteraction: false
          });
          
          // 通知クリックでウィンドウをフォーカス
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
          
          // 音を鳴らす（オプション）
          try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZQQ0PV7Dn77NgGQg+ltryxmsmBSp+zPLaizsIGGS56+OgTQ0NVKzn76xlHAY3k9jyy3YpBSV7yfDdlUELEly56+mjVhUJRp7f8sFuJAUuhNHzzX4yBh1svO7mnEIND1Wt5++uZBsIO5PY8sd0KgUme8rx3JA+CRZiuOndnUoODlKp5O+zYhsIOJPX8shyKwUpfcrx2486CBdjuOjdn0wODlKp5O+zYRsIOJPX8shyKwUpfcrx2486CBdjuOjdn0wODlKp5O+zYRsIOJPX8shyKwUpfcrx2486CBdjuOjdn0wO');
            audio.play().catch(e => console.log('Audio play failed:', e));
          } catch (e) {
            console.log('Audio not supported:', e);
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `from_user_id=eq.${currentUser.id}`
      },
      (payload) => {
        console.log('Parent sent message:', payload.new);
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) {
            return prev;
          }
          return [...prev, {
            id: payload.new.id,
            from: payload.new.from_user_id,
            to: payload.new.to_user_id,
            text: payload.new.text,
            timestamp: new Date(payload.new.created_at),
            read: payload.new.read
          }];
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [currentUser?.id]);

// アラートのリアルタイム購読とブラウザ通知
useEffect(() => {
  if (!currentUser || currentUser.role !== 'parent') return;

  const channel = supabase
    .channel('alerts')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'alerts'
      },
      async (payload) => {
        console.log('New alert received:', payload.new);
        
        // 自分の子供のアラートかチェック
        const { data: relationships } = await supabase
          .from('parent_children')
          .select('child_id')
          .eq('parent_id', currentUser.id);
        
        if (relationships) {
          const childIds = relationships.map(r => r.child_id);
          const { data: membersData } = await supabase
            .from('members')
            .select('id, user_id')
            .in('user_id', childIds);
          
          if (membersData) {
            const memberIds = membersData.map(m => m.id);
            
            // 自分の子供のアラートの場合のみ追加
            if (memberIds.includes(payload.new.member_id)) {
              setAlerts(prev => [{
                id: payload.new.id,
                type: payload.new.type,
                memberId: payload.new.member_id,
                message: payload.new.message,
                timestamp: new Date(payload.new.created_at),
                read: payload.new.read || false
              }, ...prev]);
              
              if (Notification.permission === 'granted') {
                new Notification('Family Safe - 緊急アラート', {
                  body: payload.new.message,
                  requireInteraction: true
                });
              }
            }
          }
        }
      }
    )
    .subscribe();

  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  return () => {
    supabase.removeChannel(channel);
  };
}, [currentUser?.id, currentUser?.role]);

// GPS状態のリアルタイム購読（子供側）
useEffect(() => {
  if (!currentUser || currentUser.role !== 'child') return;

  const myProfile = members.find(m => m.userId === currentUser.id);
  if (!myProfile) return;

  const channel = supabase
    .channel(`member-gps-${myProfile.id}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'members',
        filter: `id=eq.${myProfile.id}`
      },
      (payload) => {
        const newGpsState = payload.new.gps_enabled;
        console.log('GPS state changed:', newGpsState);
        setGpsEnabled(newGpsState);
        
        if (!newGpsState && watchIdRef.current !== null) {
          console.log('Clearing watchPosition:', watchIdRef.current);
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        
        setMembers(prev => prev.map(m => 
          m.id === myProfile.id ? { ...m, gpsActive: newGpsState, isMoving: newGpsState } : m
        ));
      }
    )
    .subscribe((status) => {
      console.log('GPS subscription status:', status);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}, [currentUser, members]);

// GPS状態のリアルタイム購読（親側）
useEffect(() => {
  if (!currentUser || currentUser.role !== 'parent') return;
  if (members.length === 0) return;

  const channels = members.map(member => {
    const channel = supabase
      .channel(`parent-gps-${member.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'members',
          filter: `id=eq.${member.id}`
        },
        (payload) => {
          console.log('Parent received GPS update:', payload.new);
          setMembers(prev => prev.map(m => 
            m.id === member.id ? { 
              ...m, 
              gpsActive: payload.new.gps_enabled,
              isMoving: payload.new.gps_enabled,
              location: {
                lat: payload.new.latitude || m.location.lat,
                lng: payload.new.longitude || m.location.lng,
                address: payload.new.address || m.location.address
              },
              battery: payload.new.battery || m.battery,
              lastUpdate: new Date(payload.new.last_update || Date.now())
            } : m
          ));
        }
      )
      .subscribe((status) => {
        console.log(`Parent GPS subscription for ${member.name}:`, status);
      });
    
    return channel;
  });

  return () => {
    channels.forEach(channel => supabase.removeChannel(channel));
  };
}, [currentUser, members.length]);

// 1. グループ一覧画面
const GroupListScreen = () => {
  const [myGroups, setMyGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMyGroups();
  }, []);

  const loadMyGroups = async () => {
    if (!currentUser) return;
    
    try {
      const { data: memberData } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUser.id);
      
      if (!memberData || memberData.length === 0) {
        setMyGroups([]);
        setLoading(false);
        return;
      }
      
      const groupIds = memberData.map(m => m.group_id);
      
      const { data: groupsData } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds)
        .order('created_at', { ascending: false });
      
      if (groupsData) {
        const groupsWithMemberCount = await Promise.all(
          groupsData.map(async (group) => {
            const { data: members } = await supabase
              .from('group_members')
              .select('user_id')
              .eq('group_id', group.id);
            
            return {
              ...group,
              memberCount: members?.length || 0
            };
          })
        );
        
        setMyGroups(groupsWithMemberCount);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Load groups error:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{textAlign: 'center'}}>
          <div style={{
            width: '60px', 
            height: '60px', 
            border: '4px solid rgba(255,255,255,0.3)', 
            borderTop: '4px solid white', 
            borderRadius: '50%', 
            animation: 'spin 1s linear infinite', 
            margin: '0 auto 1.5rem'
          }}></div>
          <p style={{color: 'white', fontSize: '1.1rem', fontWeight: '500'}}>読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '2rem'
    }}>
      <div style={{maxWidth: '900px', margin: '0 auto'}}>
        {/* ヘッダー */}
        <div style={{
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '2rem'
        }}>
          <div>
            <h1 style={{
              fontSize: '2.5rem', 
              color: 'white', 
              margin: 0,
              fontWeight: '700',
              textShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <Users size={40} style={{verticalAlign: 'middle', marginRight: '0.75rem'}} />
              グループ
            </h1>
            <p style={{
              color: 'rgba(255,255,255,0.9)', 
              margin: '0.75rem 0 0 0',
              fontSize: '1.1rem',
              fontWeight: '400'
            }}>
              家族や友達とグループチャット
            </p>
          </div>
          <button 
            onClick={() => setCurrentView(currentUser?.role === 'parent' ? 'parent-dashboard' : 'child-dashboard')}
            style={{
              padding: '0.875rem 1.75rem', 
              background: 'rgba(255,255,255,0.2)', 
              backdropFilter: 'blur(10px)',
              color: 'white', 
              border: '2px solid rgba(255,255,255,0.3)', 
              borderRadius: '12px', 
              cursor: 'pointer', 
              fontWeight: '600',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
          >
            <i className="fas fa-arrow-left"></i>
            戻る
          </button>
        </div>

        {/* グループ作成ボタン */}
        <button
          onClick={() => setCurrentView('create-group')}
          style={{
            width: '100%',
            padding: '1.5rem',
            background: 'white',
            color: '#667eea',
            border: 'none',
            borderRadius: '16px',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '1.2rem',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
          }}
        >
          <Plus size={28} />
          新しいグループを作成
        </button>

        {/* グループリスト */}
        {myGroups.length === 0 ? (
          <div style={{
            background: 'white', 
            padding: '4rem 2rem', 
            borderRadius: '20px', 
            textAlign: 'center', 
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
          }}>
            <div style={{
              width: '100px',
              height: '100px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 2rem',
              opacity: 0.9
            }}>
              <Users size={48} style={{color: 'white'}} />
            </div>
            <h3 style={{
              color: '#333', 
              marginBottom: '0.75rem',
              fontSize: '1.5rem',
              fontWeight: '600'
            }}>
              グループがありません
            </h3>
            <p style={{
              color: '#666', 
              fontSize: '1rem',
              lineHeight: '1.6',
              maxWidth: '400px',
              margin: '0 auto'
            }}>
              新しいグループを作成して、<br/>
              家族や友達とチャットを始めましょう
            </p>
          </div>
        ) : (
          <div style={{display: 'grid', gap: '1rem'}}>
            {myGroups.map(group => (
              <div
                key={group.id}
                onClick={() => {
                  sessionStorage.setItem('selectedGroupId', group.id);
                  setCurrentView('group-chat');
                }}
                style={{
                  background: 'white',
                  padding: '1.75rem',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  transition: 'all 0.2s',
                  border: '2px solid transparent'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                  e.currentTarget.style.borderColor = '#667eea';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '1.25rem', flex: 1}}>
                    {/* グループアバター - 画像対応 */}
                    <div style={{
                      width: '70px',
                      height: '70px',
                      borderRadius: '50%',
                      background: group.avatar_url ? 'white' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: '1.75rem',
                      fontWeight: '700',
                      flexShrink: 0,
                      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
                      overflow: 'hidden',
                      border: group.avatar_url ? '3px solid #e5e7eb' : 'none'
                    }}>
                      {group.avatar_url ? (
                        <img 
                          src={group.avatar_url} 
                          alt={group.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      ) : (
                        <Users size={32} />
                      )}
                    </div>
                    <div style={{flex: 1}}>
                      <h3 style={{
                        margin: 0, 
                        fontSize: '1.4rem', 
                        color: '#333',
                        fontWeight: '700',
                        marginBottom: '0.5rem'
                      }}>
                        {group.name}
                      </h3>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: '#667eea',
                        fontSize: '0.95rem',
                        fontWeight: '500'
                      }}>
                        <Users size={16} />
                        <span>{group.memberCount}人のメンバー</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={32} style={{color: '#667eea', flexShrink: 0}} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// 2. グループ作成画面
const CreateGroupScreen = () => {
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [availableMembers, setAvailableMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAvailableMembers();
  }, []);

  const loadAvailableMembers = async () => {
    if (!currentUser) return;
    
    try {
      if (currentUser.role === 'parent') {
        const { data: relationships } = await supabase
          .from('parent_children')
          .select('child_id')
          .eq('parent_id', currentUser.id);
        
        if (relationships && relationships.length > 0) {
          const childIds = relationships.map(r => r.child_id);
          
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, role')
            .in('id', childIds);
          
          if (profiles) {
            setAvailableMembers(profiles.map(p => ({
              id: p.id,
              name: p.name,
              role: p.role
            })));
          }
        }
      } else {
        const { data: relationships } = await supabase
          .from('parent_children')
          .select('parent_id')
          .eq('child_id', currentUser.id);
        
        if (relationships && relationships.length > 0) {
          const parentIds = relationships.map(r => r.parent_id);
          
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, role')
            .in('id', parentIds);
          
          if (profiles) {
            setAvailableMembers(profiles.map(p => ({
              id: p.id,
              name: p.name,
              role: p.role
            })));
          }
        }
      }
    } catch (error) {
      console.error('Load members error:', error);
    }
  };

  const toggleMember = (memberId) => {
    if (selectedMembers.includes(memberId)) {
      setSelectedMembers(selectedMembers.filter(id => id !== memberId));
    } else {
      setSelectedMembers([...selectedMembers, memberId]);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      alert('グループ名を入力してください');
      return;
    }
    
    if (selectedMembers.length === 0) {
      alert('少なくとも1人のメンバーを選択してください');
      return;
    }

    setLoading(true);

    try {
      console.log('[GROUP CREATE] Starting group creation...');
      console.log('[GROUP CREATE] Group name:', groupName);
      console.log('[GROUP CREATE] Selected members:', selectedMembers);
      console.log('[GROUP CREATE] Current user:', currentUser.id);

      // グループを作成
      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert([{
          name: groupName,
          created_by: currentUser.id
        }])
        .select()
        .single();

      if (groupError) {
        console.error('[GROUP CREATE] Group creation error:', groupError);
        alert('グループの作成に失敗しました: ' + groupError.message);
        setLoading(false);
        return;
      }

      console.log('[GROUP CREATE] Group created:', newGroup);

      // 自分とメンバーを追加
      const membersToAdd = [currentUser.id, ...selectedMembers];
      console.log('[GROUP CREATE] Adding members:', membersToAdd);
      
      const { error: membersError } = await supabase
        .from('group_members')
        .insert(
          membersToAdd.map(userId => ({
            group_id: newGroup.id,
            user_id: userId
          }))
        );

      if (membersError) {
        console.error('[GROUP CREATE] Add members error:', membersError);
        alert('メンバーの追加に失敗しました: ' + membersError.message);
        setLoading(false);
        return;
      }

      console.log('[GROUP CREATE] Members added successfully');
      alert('グループを作成しました！');
      setCurrentView('group-list');
    } catch (error) {
      console.error('[GROUP CREATE] Unexpected error:', error);
      alert('エラーが発生しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '2rem'
    }}>
      <div style={{maxWidth: '700px', margin: '0 auto'}}>
        <div style={{
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '2rem'
        }}>
          <div>
            <h1 style={{
              fontSize: '2.5rem', 
              color: 'white', 
              margin: 0,
              fontWeight: '700',
              textShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              <Plus size={36} style={{verticalAlign: 'middle', marginRight: '0.75rem'}} />
              グループを作成
            </h1>
            <p style={{
              color: 'rgba(255,255,255,0.9)', 
              margin: '0.75rem 0 0 0',
              fontSize: '1.1rem'
            }}>
              新しいグループチャットを始めましょう
            </p>
          </div>
          <button 
            onClick={() => setCurrentView('group-list')}
            style={{
              padding: '0.875rem 1.75rem', 
              background: 'rgba(255,255,255,0.2)', 
              backdropFilter: 'blur(10px)',
              color: 'white', 
              border: '2px solid rgba(255,255,255,0.3)', 
              borderRadius: '12px', 
              cursor: 'pointer', 
              fontWeight: '600',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.3)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <i className="fas fa-arrow-left"></i>
            戻る
          </button>
        </div>

        <div style={{
          background: 'white', 
          padding: '2.5rem', 
          borderRadius: '20px', 
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          marginBottom: '1.5rem'
        }}>
          <div style={{marginBottom: '2.5rem'}}>
            <label style={{
              display: 'block', 
              marginBottom: '0.75rem', 
              color: '#333', 
              fontWeight: '700',
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <i className="fas fa-users" style={{color: '#667eea'}}></i>
              グループ名
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例: 家族グループ"
              style={{
                width: '100%',
                padding: '1rem 1.25rem',
                border: '2px solid #e9ecef',
                borderRadius: '12px',
                fontSize: '1.1rem',
                transition: 'all 0.2s',
                outline: 'none'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#667eea';
                e.target.style.boxShadow = '0 0 0 4px rgba(102, 126, 234, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e9ecef';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block', 
              marginBottom: '1rem', 
              color: '#333', 
              fontWeight: '700',
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <i className="fas fa-user-friends" style={{color: '#667eea'}}></i>
              メンバーを選択
              <span style={{
                fontSize: '0.85rem',
                color: '#999',
                fontWeight: '400',
                marginLeft: '0.5rem'
              }}>
                ({selectedMembers.length}人選択中)
              </span>
            </label>
            
            {availableMembers.length === 0 ? (
              <div style={{
                textAlign: 'center', 
                padding: '3rem 2rem',
                background: '#f8f9fa',
                borderRadius: '12px',
                border: '2px dashed #e9ecef'
              }}>
                <User size={48} style={{color: '#ccc', marginBottom: '1rem'}} />
                <p style={{color: '#999', margin: 0, fontSize: '1rem'}}>
                  追加できるメンバーがいません
                </p>
              </div>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
                {availableMembers.map(member => (
                  <div
                    key={member.id}
                    onClick={() => toggleMember(member.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '1.25rem',
                      background: selectedMembers.includes(member.id) ? '#f0f4ff' : '#f8f9fa',
                      border: `2px solid ${selectedMembers.includes(member.id) ? '#667eea' : '#e9ecef'}`,
                      borderRadius: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      if (!selectedMembers.includes(member.id)) {
                        e.currentTarget.style.borderColor = '#667eea';
                        e.currentTarget.style.transform = 'translateX(4px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selectedMembers.includes(member.id)) {
                        e.currentTarget.style.borderColor = '#e9ecef';
                        e.currentTarget.style.transform = 'translateX(0)';
                      }
                    }}
                  >
                    <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                      <div style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '50%',
                        background: member.role === 'parent' 
                          ? 'linear-gradient(135000 0%, #d97706 100%)' 
                          : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: '700',
                        fontSize: '1.2rem',
                        flexShrink: 0
                      }}>
                        {member.role === 'parent' ? 'P' : 'C'}
                      </div>
                      <div>
                        <h4 style={{margin: 0, color: '#333', fontSize: '1.1rem', fontWeight: '600'}}>
                          {member.name}
                        </h4>
                        <p style={{margin: '0.25rem 0 0 0', fontSize: '0.9rem', color: '#666'}}>
                          {member.role === 'parent' ? '保護者' : '子供'}
                        </p>
                      </div>
                    </div>
                    {selectedMembers.includes(member.id) && (
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: '#667eea',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Check size={20} style={{color: 'white'}} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={createGroup}
          disabled={loading || !groupName.trim() || selectedMembers.length === 0}
          style={{
            width: '100%',
            padding: '1.25rem',
            background: loading || !groupName.trim() || selectedMembers.length === 0
              ? '#ccc' 
              : 'white',
            color: loading || !groupName.trim() || selectedMembers.length === 0
              ? '#999'
              : '#667eea',
            border: 'none',
            borderRadius: '16px',
            cursor: loading || !groupName.trim() || selectedMembers.length === 0 
              ? 'not-allowed' 
              : 'pointer',
            fontWeight: '700',
            fontSize: '1.2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            if (!loading && groupName.trim() && selectedMembers.length > 0) {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.2)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
          }}
        >
          {loading ? (
            <>
              <div style={{
                width: '20px',
                height: '20px',
                border: '3px solid #f3f3f3',
                borderTop: '3px solid #999',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              作成中...
            </>
          ) : (
            <>
              <Plus size={24} />
              グループを作成
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// 3. グループチャット画面（管理機能付き）- グループ画像編集＆プロフィール表示機能追加
const GroupChatScreen = () => {
  const [newMessage, setNewMessage] = useState('');
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupInfo, setGroupInfo] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [onlineStatus, setOnlineStatus] = useState({});
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showTransferAdmin, setShowTransferAdmin] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showMemberProfile, setShowMemberProfile] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [showGroupImageEdit, setShowGroupImageEdit] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectedGroupId = sessionStorage.getItem('selectedGroupId');
  const isAdmin = groupInfo?.created_by === currentUser?.id;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [groupMessages]);

  // 絵文字の配列
  const emojis = ['😀', '😂', '🥰', '😍', '🤔', '😅', '😊', '👍', '❤️', '🎉', '🔥', '✨', '💯', '👏', '🙏', '😭', '😱', '🤗', '😎', '🥳', '😴', '🤪', '💪', '👌', '✌️', '🙌', '👋', '💕', '💖', '🌟'];

  const addEmoji = (emoji) => {
    if (editingMessageId) {
      setEditingMessageText(prev => prev + emoji);
    } else {
      setNewMessage(prev => prev + emoji);
    }
  };

  // メッセージ削除
  const deleteMessage = async (messageId) => {
    if (!confirm('このメッセージを削除しますか？')) return;

    try {
      const { error } = await supabase
        .from('group_messages')
        .delete()
        .eq('id', messageId);

      if (error) {
        console.error('Delete message error:', error);
        alert('メッセージの削除に失敗しました');
        return;
      }

      setGroupMessages(prev => prev.filter(m => m.id !== messageId));
      setShowMessageMenu(null);
    } catch (error) {
      console.error('Delete message error:', error);
      alert('メッセージの削除に失敗しました');
    }
  };

  // メッセージ編集開始
  const startEditMessage = (message) => {
    setEditingMessageId(message.id);
    setEditingMessageText(message.text);
    setShowMessageMenu(null);
  };

  // メッセージ編集キャンセル
  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
  };

  // メッセージ編集保存
  const saveEditMessage = async () => {
    if (!editingMessageText.trim() || !editingMessageId) return;

    try {
      const { error } = await supabase
        .from('group_messages')
        .update({ 
          text: editingMessageText,
          edited: true,
          edited_at: new Date().toISOString()
        })
        .eq('id', editingMessageId);

      if (error) {
        console.error('Edit message error:', error);
        alert('メッセージの編集に失敗しました');
        return;
      }

      setGroupMessages(prev => prev.map(m => 
        m.id === editingMessageId ? {
          ...m,
          text: editingMessageText,
          edited: true,
          editedAt: new Date()
        } : m
      ));

      setEditingMessageId(null);
      setEditingMessageText('');
    } catch (error) {
      console.error('Edit message error:', error);
      alert('メッセージの編集に失敗しました');
    }
  };

  // 既読マーク追加
  const markMessageAsRead = async (messageId) => {
    try {
      const { error } = await supabase
        .from('group_message_reads')
        .upsert({
          message_id: messageId,
          user_id: currentUser.id,
          read_at: new Date().toISOString()
        });

      if (error) {
        console.error('Mark as read error:', error);
      }
    } catch (error) {
      console.error('Mark as read error:', error);
    }
  };

  useEffect(() => {
    if (selectedGroupId) {
      loadGroupInfo();
      loadGroupMembers();
      loadGroupMessages();
    } else {
      setCurrentView('group-list');
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId || groupMembers.length === 0) return;

    const memberIds = groupMembers.map(m => m.id);

    const channel = supabase
      .channel(`presence-${selectedGroupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_presence',
          filter: `user_id=in.(${memberIds.join(',')})`
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const { user_id, status, last_seen } = payload.new;
            const lastSeen = new Date(last_seen);
            const now = new Date();
            const diffSeconds = (now - lastSeen) / 1000;
            
            setOnlineStatus(prev => ({
              ...prev,
              [user_id]: diffSeconds < 30 ? status : 'offline'
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedGroupId, groupMembers.length]);

// メッセージが表示されたら既読をつける
useEffect(() => {
  if (!selectedGroupId || !currentUser?.id || groupMessages.length === 0) return;

  const markMessagesAsRead = async () => {
    const unreadMessages = groupMessages.filter(m => 
      m.userId !== currentUser.id && 
      (!m.readBy || !m.readBy.includes(currentUser.id))
    );

    if (unreadMessages.length === 0) return;

    try {
      const reads = unreadMessages.map(m => ({
        message_id: m.id,
        user_id: currentUser.id,
        read_at: new Date().toISOString()
      }));

      await supabase
        .from('group_message_reads')
        .upsert(reads);
    } catch (error) {
      console.error('Mark as read error:', error);
    }
  };

  // 1秒後に既読処理を実行（スクロールが落ち着いてから）
  const timer = setTimeout(markMessagesAsRead, 1000);

  return () => clearTimeout(timer);
}, [groupMessages.length, selectedGroupId, currentUser?.id]);

useEffect(() => {
  if (!selectedGroupId) return;

  const channel = supabase
    .channel(`group-${selectedGroupId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${selectedGroupId}`
      },
      async (payload) => {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name, avatar_url')
          .eq('id', payload.new.from_user_id)
          .single();
        
        setGroupMessages(prev => {
          // 重複チェック
          if (prev.some(m => m.id === payload.new.id)) {
            return prev;
          }
          return [...prev, {
            id: payload.new.id,
            userId: payload.new.from_user_id,
            userName: profile?.name || '不明',
            avatarUrl: profile?.avatar_url,
            text: payload.new.text,
            timestamp: new Date(payload.new.created_at),
            edited: payload.new.edited || false,
            editedAt: payload.new.edited_at ? new Date(payload.new.edited_at) : null,
            readBy: []
          }];
        });
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${selectedGroupId}`
      },
      (payload) => {
        console.log('Message updated:', payload.new);
        setGroupMessages(prev => prev.map(m =>
          m.id === payload.new.id ? {
            ...m,
            text: payload.new.text,
            edited: payload.new.edited || false,
            editedAt: payload.new.edited_at ? new Date(payload.new.edited_at) : null
          } : m
        ));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${selectedGroupId}`
      },
      (payload) => {
        console.log('Message deleted:', payload.old);
        setGroupMessages(prev => prev.filter(m => m.id !== payload.old.id));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [selectedGroupId]);

// 既読情報の購読を追加
useEffect(() => {
  if (!selectedGroupId) return;

  const channel = supabase
    .channel(`group-reads-${selectedGroupId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_message_reads'
      },
      (payload) => {
        console.log('New read:', payload.new);
        setGroupMessages(prev => prev.map(m => {
          if (m.id === payload.new.message_id) {
            const newReadBy = m.readBy || [];
            if (!newReadBy.includes(payload.new.user_id)) {
              return {
                ...m,
                readBy: [...newReadBy, payload.new.user_id]
              };
            }
          }
          return m;
        }));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [selectedGroupId]);

  const loadGroupInfo = async () => {
    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('id', selectedGroupId)
        .single();
      
      if (error) {
        console.error('Load group info error:', error);
        return;
      }
      
      setGroupInfo(data);
    } catch (error) {
      console.error('Load group info error:', error);
    }
  };

  const loadGroupMembers = async () => {
    try {
      const { data: memberData } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', selectedGroupId);
      
      if (memberData) {
        const userIds = memberData.map(m => m.user_id);
        
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, role, avatar_url')
          .in('id', userIds);
        
        setGroupMembers(profiles || []);
        
        // プロフィール情報をマップに保存
        const profileMap = {};
        profiles?.forEach(p => {
          profileMap[p.id] = {
            name: p.name,
            role: p.role,
            avatarUrl: p.avatar_url
          };
        });
        setMemberProfiles(profileMap);
        
        const { data: presenceData } = await supabase
          .from('user_presence')
          .select('user_id, status, last_seen')
          .in('user_id', userIds);
        
        const statusMap = {};
        presenceData?.forEach(item => {
          const lastSeen = new Date(item.last_seen);
          const now = new Date();
          const diffSeconds = (now - lastSeen) / 1000;
          statusMap[item.user_id] = diffSeconds < 30 ? item.status : 'offline';
        });
        
        setOnlineStatus(statusMap);
      }
    } catch (error) {
      console.error('Load group members error:', error);
    }
  };

  const loadGroupMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('group_messages')
        .select('*')
        .eq('group_id', selectedGroupId)
        .order('created_at', { ascending: true })
        .limit(100);
      
      if (error) {
        console.error('Load messages error:', error);
        return;
      }
      
      if (data) {
        const userIds = [...new Set(data.map(m => m.from_user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', userIds);
        
        const nameMap = {};
        const avatarMap = {};
        if (profiles) {
          profiles.forEach(p => {
            nameMap[p.id] = p.name;
            avatarMap[p.id] = p.avatar_url;
          });
        }
        
        // 既読情報を取得
        const messageIds = data.map(m => m.id);
        const { data: reads } = await supabase
          .from('group_message_reads')
          .select('message_id, user_id')
          .in('message_id', messageIds);
        
        const readMap = {};
        if (reads) {
          reads.forEach(r => {
            if (!readMap[r.message_id]) {
              readMap[r.message_id] = [];
            }
            readMap[r.message_id].push(r.user_id);
          });
        }
        
        setGroupMessages(data.map(m => ({
          id: m.id,
          userId: m.from_user_id,
          userName: nameMap[m.from_user_id] || '不明',
          avatarUrl: avatarMap[m.from_user_id],
          text: m.text,
          timestamp: new Date(m.created_at),
          edited: m.edited || false,
          editedAt: m.edited_at ? new Date(m.edited_at) : null,
          readBy: readMap[m.id] || []
        })));
      }
    } catch (error) {
      console.error('Load group messages error:', error);
    }
  };

  const sendGroupMessage = async () => {
    if (!newMessage.trim() || !selectedGroupId) return;
    
    const messageText = newMessage;
    const tempId = 'temp-' + Date.now();
    const timestamp = new Date();
    
    // 楽観的UI更新
    const optimisticMessage = {
      id: tempId,
      userId: currentUser.id,
      userName: currentUser.name,
      avatarUrl: currentUser.avatar_url,
      text: messageText,
      timestamp: timestamp,
      edited: false,
      readBy: []
    };
    
    setGroupMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');
    setShowEmojiPicker(false);
    
    try {
      const { data, error } = await supabase
        .from('group_messages')
        .insert([{
          group_id: selectedGroupId,
          from_user_id: currentUser.id,
          text: messageText
        }])
        .select()
        .single();

      if (error) {
        console.error('Send message error:', error);
        alert('メッセージの送信に失敗しました');
        setGroupMessages(prev => prev.filter(m => m.id !== tempId));
        setNewMessage(messageText);
        return;
      }
      
      if (data) {
        setGroupMessages(prev => prev.map(m => 
          m.id === tempId ? {
            id: data.id,
            userId: data.from_user_id,
            userName: currentUser.name,
            avatarUrl: currentUser.avatar_url,
            text: data.text,
            timestamp: new Date(data.created_at),
            edited: false,
            readBy: []
          } : m
        ));
      }
    } catch (error) {
      console.error('Send message error:', error);
      setGroupMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(messageText);
    }
  };

  const deleteGroup = async () => {
    try {
      await supabase
        .from('group_messages')
        .delete()
        .eq('group_id', selectedGroupId);
      
      await supabase
        .from('group_members')
        .delete()
        .eq('group_id', selectedGroupId);
      
      const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', selectedGroupId);
      
      if (error) {
        console.error('Delete error:', error);
        alert('グループの削除に失敗しました');
        return;
      }
      
      sessionStorage.removeItem('selectedGroupId');
      alert('グループを削除しました');
      setCurrentView('group-list');
    } catch (error) {
      console.error('Delete error:', error);
      alert('グループの削除に失敗しました');
    }
  };

  const leaveGroup = async () => {
    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', selectedGroupId)
        .eq('user_id', currentUser.id);
      
      if (error) {
        console.error('Leave error:', error);
        alert('グループの退出に失敗しました');
        return;
      }
      
      sessionStorage.removeItem('selectedGroupId');
      alert('グループから退出しました');
      setCurrentView('group-list');
    } catch (error) {
      console.error('Leave error:', error);
      alert('グループの退出に失敗しました');
    }
  };

  const transferAdmin = async (newAdminId) => {
    try {
      const { error } = await supabase
        .from('groups')
        .update({ created_by: newAdminId })
        .eq('id', selectedGroupId);
      
      if (error) {
        console.error('Transfer admin error:', error);
        alert('管理者の譲渡に失敗しました');
        return;
      }
      
      alert('管理者権限を譲渡しました');
      setShowTransferAdmin(false);
      loadGroupInfo();
    } catch (error) {
      console.error('Transfer admin error:', error);
      alert('管理者の譲渡に失敗しました');
    }
  };

  // グループ画像をアップロード
  const handleGroupImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${selectedGroupId}-${Math.random()}.${fileExt}`;
      const filePath = `group-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('groups')
        .update({ avatar_url: publicUrl })
        .eq('id', selectedGroupId);

      if (updateError) throw updateError;

      alert('グループ画像を更新しました');
      loadGroupInfo();
      setShowGroupImageEdit(false);
    } catch (error) {
      console.error('Upload error:', error);
      alert('画像のアップロードに失敗しました');
    }
  };

  // メンバープロフィールを表示
  const showMemberProfileModal = (member) => {
    setSelectedMember(member);
    setShowMemberProfile(true);
    setShowMembersModal(false);
  };

  if (!selectedGroupId) {
    return null;
  }

  return (
    <div className="chat-modal">
      <div className="chat-container">
        {/* ヘッダー */}
        <div className="chat-header" style={{background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
            <div 
              onClick={() => isAdmin && setShowGroupImageEdit(true)}
              style={{
                background: groupInfo?.avatar_url ? 'white' : 'rgba(255,255,255,0.3)',
                borderRadius: '50%',
                width: '48px',
                height: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexShrink: 0,
                cursor: isAdmin ? 'pointer' : 'default',
                overflow: 'hidden',
                border: groupInfo?.avatar_url ? '2px solid rgba(255,255,255,0.5)' : 'none',
                position: 'relative'
              }}
            >
              {groupInfo?.avatar_url ? (
                <>
                  <img 
                    src={groupInfo.avatar_url} 
                    alt="Group"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                  {isAdmin && (
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      background: 'rgba(0,0,0,0.6)',
                      borderRadius: '50%',
                      padding: '0.25rem',
                      display: 'flex'
                    }}>
                      <i className="fas fa-camera" style={{fontSize: '0.6rem'}}></i>
                    </div>
                  )}
                </>
              ) : (
                <Users size={24} />
              )}
            </div>
            <div>
              <h3 style={{color: 'white', margin: 0}}>{groupInfo?.name || 'グループ'}</h3>
              <p style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', margin: 0}}>
                {groupMembers.length}人のメンバー
                {isAdmin && <span style={{marginLeft: '0.5rem'}}>• 管理者</span>}
              </p>
            </div>
          </div>
          <div style={{display: 'flex', gap: '0.5rem'}}>
            <button 
              className="group-settings-btn"
              onClick={() => setShowMenu(!showMenu)}
              style={{background: 'rgba(255,255,255,0.2)', color: 'white', position: 'relative'}}
            >
              <Settings size={20} />
              
              {showMenu && (
                <div className="group-settings-menu">
                  <button
                    className="group-settings-item"
                    onClick={() => {
                      setShowMenu(false);
                      setShowMembersModal(true);
                    }}
                  >
                    <Users size={18} />
                    メンバー一覧
                  </button>
                  {isAdmin && (
                    <button
                      className="group-settings-item"
                      onClick={() => {
                        setShowMenu(false);
                        setShowGroupImageEdit(true);
                      }}
                    >
                      <i className="fas fa-image"></i>
                      グループ画像を変更
                    </button>
                  )}
                  {isAdmin ? (
                    <>
                      <button
                        className="group-settings-item"
                        onClick={() => {
                          setShowMenu(false);
                          setShowTransferAdmin(true);
                        }}
                      >
                        <i className="fas fa-user-crown"></i>
                        管理者を譲渡
                      </button>
                      <button
                        className="group-settings-item danger"
                        onClick={() => {
                          setShowMenu(false);
                          setShowDeleteConfirm(true);
                        }}
                      >
                        <i className="fas fa-trash-alt"></i>
                        グループを削除
                      </button>
                    </>
                  ) : (
                    <button
                      className="group-settings-item warning"
                      onClick={() => {
                        setShowMenu(false);
                        setShowLeaveConfirm(true);
                      }}
                    >
                      <i className="fas fa-sign-out-alt"></i>
                      グループから退出
                    </button>
                  )}
                </div>
              )}
            </button>
            
            <button 
              className="close-btn"
              onClick={() => setCurrentView('group-list')}
              style={{background: 'rgba(255,255,255,0.2)', color: 'white'}}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* メッセージエリア */}
        <div className="chat-messages" style={{
          background: '#e5ddd5', 
          padding: '1rem',
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          flex: 1
        }}>
          <style>{`
            .chat-messages::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          {groupMessages.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999'
            }}>
              <MessageCircle size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
              <p>まだメッセージがありません</p>
              <p style={{fontSize: '0.85rem'}}>最初のメッセージを送信しましょう</p>
            </div>
          ) : (
            <>
              {groupMessages.map(msg => {
                const isMine = msg.userId === currentUser.id;
                const profile = memberProfiles[msg.userId];
                const readCount = msg.readBy ? msg.readBy.filter(id => id !== msg.userId).length : 0;
                const totalMembers = groupMembers.length;
                
                return (
                  <div 
                    key={msg.id} 
                    style={{
                      display: 'flex',
                      flexDirection: isMine ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                      marginBottom: '1rem',
                      gap: '0.5rem',
                      width: '100%'
                    }}
                  >
                    {/* アバター表示（相手のメッセージのみ） */}
                    {!isMine && (
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: msg.avatarUrl ? 'white' : (profile?.role === 'parent' ? 'linear-gradient(135deg, #667eea 0%, #d97706 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: '700',
                        fontSize: '0.9rem',
                        flexShrink: 0,
                        overflow: 'hidden',
                        border: msg.avatarUrl ? '2px solid #ddd' : 'none'
                      }}>
                        {msg.avatarUrl ? (
                          <img 
                            src={msg.avatarUrl} 
                            alt={msg.userName}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          profile?.role === 'parent' ? 'P' : 'C'
                        )}
                      </div>
                    )}
                    
                    {/* メッセージ本体 */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      maxWidth: '65%',
                      width: 'auto',
                      position: 'relative'
                    }}>
                      {/* 送信者名（相手のメッセージのみ） */}
                      {!isMine && (
                        <div style={{
                          fontSize: '0.7rem', 
                          fontWeight: '600', 
                          marginBottom: '0.25rem', 
                          color: '#666',
                          paddingLeft: '0.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          {msg.userName}
                          {msg.userId === groupInfo?.created_by && ' 👑'}
                        </div>
                      )}
                      
                      {/* メッセージバブル */}
                      <div 
                        onContextMenu={(e) => {
                          if (isMine) {
                            e.preventDefault();
                            setShowMessageMenu(showMessageMenu === msg.id ? null : msg.id);
                          }
                        }}
                        onClick={() => {
                          if (isMine && showMessageMenu !== msg.id) {
                            setShowMessageMenu(msg.id);
                          } else if (!isMine && !msg.readBy?.includes(currentUser.id)) {
                            markMessageAsRead(msg.id);
                          }
                        }}
                        style={{
                          padding: '0.625rem 0.875rem',
                          borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          background: isMine ? '#dcf8c6' : 'white',
                          color: '#000',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          position: 'relative',
                          wordBreak: 'break-word',
                          width: 'fit-content',
                          minWidth: '60px',
                          cursor: isMine ? 'pointer' : 'default'
                        }}
                      >
                        <p style={{margin: 0, lineHeight: '1.4', fontSize: '0.95rem'}}>{msg.text}</p>
                        
                        {/* 時間と既読表示 */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '0.25rem',
                          marginTop: '0.25rem'
                        }}>
                          <small style={{fontSize: '0.65rem', color: '#889'}}>
                            {msg.timestamp.toLocaleTimeString('ja-JP', { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                            {msg.edited && ' • 編集済み'}
                          </small>
                          {isMine && readCount > 0 && (
                            <span style={{
                              fontSize: '0.65rem', 
                              color: readCount >= (totalMembers - 1) ? '#4fc3f7' : '#999',
                              fontWeight: '600'
                            }}>
                              既読 {readCount}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* メッセージメニュー */}
                      {isMine && showMessageMenu === msg.id && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: '0.25rem',
                          background: 'white',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          overflow: 'hidden',
                          zIndex: 1000,
                          minWidth: '120px'
                        }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditMessage(msg);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.75rem 1rem',
                              background: 'none',
                              border: 'none',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: '#333'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                          >
                            <i className="fas fa-edit" style={{width: '16px'}}></i>
                            編集
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMessage(msg.id);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.75rem 1rem',
                              background: 'none',
                              border: 'none',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: '#ef4444'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                          >
                            <i className="fas fa-trash" style={{width: '16px'}}></i>
                            削除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* 入力エリア */}
        <div className="chat-input" style={{background: '#f0f0f0', padding: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end', position: 'relative'}}>
          {editingMessageId ? (
            // 編集モード
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{
                fontSize: '0.8rem',
                color: '#667eea',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <i className="fas fa-edit"></i>
                メッセージを編集中
              </div>
              <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowEmojiPicker(!showEmojiPicker);
                  }}
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  😊
                </button>
                
                {showEmojiPicker && (
                  <div style={{
                    position: 'absolute',
                    bottom: '70px',
                    left: '10px',
                    background: 'white',
                    border: '1px solid #e9ecef',
                    borderRadius: '12px',
                    padding: '0.75rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: '0.5rem',
                    maxWidth: '300px',
                    zIndex: 1000
                  }}>
                    {emojis.map((emoji, index) => (
                      <button
                        key={index}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          addEmoji(emoji);
                        }}
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          fontSize: '1.5rem',
                          cursor: 'pointer',
                          padding: '0.25rem',
                          borderRadius: '4px',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                
                <input 
                  type="text" 
                  value={editingMessageText} 
                  onChange={(e) => setEditingMessageText(e.target.value)} 
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault(); 
                      saveEditMessage();
                    } else if (e.key === 'Escape') {
                      cancelEditMessage();
                    }
                  }}
                  placeholder="メッセージを編集..." 
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: '2px solid #667eea',
                    borderRadius: '20px',
                    fontSize: '0.95rem',
                    outline: 'none'
                  }}
                />
                <button 
                  onClick={(e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    saveEditMessage();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  type="button"
                  style={{
                    background: '#10b981',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    flexShrink: 0
                  }}
                >
                  <Check size={20} />
                </button>
                <button 
                  onClick={(e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    cancelEditMessage();
                  }}
                  type="button"
                  style={{
                    background: '#ef4444',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    flexShrink: 0
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          ) : (
            // 通常モード
            <>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowEmojiPicker(!showEmojiPicker);
                }}
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                😊
              </button>
              
              {showEmojiPicker && (
                <div style={{
                  position: 'absolute',
                  bottom: '70px',
                  left: '10px',
                  background: 'white',
                  border: '1px solid #e9ecef',
                  borderRadius: '12px',
                  padding: '0.75rem',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: '0.5rem',
                  maxWidth: '300px',
                  zIndex: 1000
                }}>
                  {emojis.map((emoji, index) => (
                    <button
                      key={index}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        addEmoji(emoji);
                      }}
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        padding: '0.25rem',
                        borderRadius: '4px',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendGroupMessage();
                  }
                }}
                placeholder="メッセージを入力..."
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '20px',
                  fontSize: '0.95rem',
                  outline: 'none'
                }}
              />
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  sendGroupMessage();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                className="send-btn"
                type="button"
                style={{
                  background: '#667eea',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'white',
                  flexShrink: 0
                }}
              >
                <Send size={20} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* グループ画像編集モーダル */}
      {showGroupImageEdit && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem'
          }}
          onClick={() => setShowGroupImageEdit(false)}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '20px',
              padding: '2rem',
              maxWidth: '400px',
              width: '100%',
              textAlign: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{marginBottom: '1.5rem'}}>グループ画像を変更</h2>
            
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: groupInfo?.avatar_url ? 'white' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              margin: '0 auto 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              border: '4px solid #e9ecef'
            }}>
              {groupInfo?.avatar_url ? (
                <img 
                  src={groupInfo.avatar_url} 
                  alt="Group"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
              ) : (
                <Users size={48} color="white" />
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleGroupImageUpload}
              style={{display: 'none'}}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%',
                padding: '0.875rem',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                marginBottom: '0.75rem'
              }}
            >
              画像を選択
            </button>

            <button
              onClick={() => setShowGroupImageEdit(false)}
              style={{
                width: '100%',
                padding: '0.875rem',
                background: '#f8f9fa',
                color: '#495057',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* メンバー一覧モーダル - LINE風デザイン */}
      {showMembersModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem'
          }}
          onClick={() => setShowMembersModal(false)}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '20px',
              maxWidth: '450px',
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #e9ecef',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div>
                  <h2 style={{margin: 0, fontSize: '1.25rem'}}>メンバー</h2>
                  <p style={{margin: '0.25rem 0 0 0', fontSize: '0.85rem', opacity: 0.9}}>{groupMembers.length}人</p>
                </div>
                <button
                  onClick={() => setShowMembersModal(false)}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    borderRadius: '50%',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '36px',
                    height: '36px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {/* メンバーリスト */}
            <div style={{
              overflowY: 'auto',
              flex: 1,
              padding: '0.5rem 0'
            }}>
              {groupMembers.length === 0 ? (
                <div style={{
                  padding: '3rem 1.5rem',
                  textAlign: 'center',
                  color: '#718096'
                }}>
                  <Users size={48} style={{opacity: 0.3, marginBottom: '1rem'}} />
                  <p style={{margin: 0, fontSize: '0.95rem'}}>メンバーが見つかりません</p>
                  <p style={{margin: '0.5rem 0 0 0', fontSize: '0.85rem'}}>グループにメンバーを追加してください</p>
                </div>
              ) : (
                groupMembers.map((member, index) => {
                const isOnline = onlineStatus[member.id] === 'online';
                
                return (
                  <div 
                    key={member.id}
                    onClick={() => showMemberProfileModal(member)}
                    style={{
                      padding: '0.875rem 1.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.875rem',
                      borderBottom: index < groupMembers.length - 1 ? '1px solid #f0f0f0' : 'none',
                      transition: 'background 0.2s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* アバター */}
                    <div style={{position: 'relative', flexShrink: 0}}>
                      <div style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '50%',
                        background: member.avatar_url ? 'white' : (member.role === 'parent' ? 'linear-gradient(135deg, #667eea 0%, #d97706 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: '700',
                        fontSize: '1.3rem',
                        overflow: 'hidden',
                        border: member.avatar_url ? '2px solid #e9ecef' : 'none'
                      }}>
                        {member.avatar_url ? (
                          <img 
                            src={member.avatar_url} 
                            alt={member.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          member.role === 'parent' ? 'P' : 'C'
                        )}
                      </div>
                      {/* オンライン状態インジケーター */}
                      <div style={{
                        position: 'absolute',
                        bottom: '2px',
                        right: '2px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: isOnline ? '#06d6a0' : '#8e9aaf',
                        border: '3px solid white',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}></div>
                    </div>
                    
                    {/* メンバー情報 */}
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{
                        fontWeight: '600',
                        fontSize: '1rem',
                        marginBottom: '0.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: '#2d3748'
                      }}>
                        <span style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>{member.name}</span>
                        
                        {/* バッジ類 */}
                        <div style={{display: 'flex', gap: '0.25rem', flexShrink: 0}}>
                          {member.id === currentUser.id && (
                            <span style={{
                              fontSize: '0.65rem',
                              color: 'white',
                              background: '#667eea',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '10px',
                              fontWeight: '700',
                              letterSpacing: '0.5px'
                            }}>YOU</span>
                          )}
                          {member.id === groupInfo?.created_by && (
                            <span style={{fontSize: '1rem'}}>👑</span>
                          )}
                        </div>
                      </div>
                      
                      {/* ロールとステータス */}
                      <div style={{
                        fontSize: '0.8rem',
                        color: '#718096',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        <span style={{
                          background: member.role === 'parent' ? '#fef3c7' : '#e0e7ff',
                          color: member.role === 'parent' ? '#b45309' : '#4c51bf',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '10px',
                          fontSize: '0.7rem',
                          fontWeight: '700',
                          letterSpacing: '0.3px'
                        }}>
                          {member.role === 'parent' ? '保護者' : '子供'}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          color: isOnline ? '#06d6a0' : '#8e9aaf',
                          fontWeight: '600'
                        }}>
                          {isOnline ? 'オンライン' : 'オフライン'}
                        </span>
                      </div>
                    </div>
                    
                    {/* 右矢印アイコン */}
                    <div style={{color: '#cbd5e0'}}>
                      <i className="fas fa-chevron-right"></i>
                    </div>
                  </div>
                );
              })
              )}
            </div>
          </div>
        </div>
      )}

      {/* メンバープロフィールモーダル */}
      {showMemberProfile && selectedMember && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
            padding: '1rem'
          }}
          onClick={() => {
            setShowMemberProfile(false);
            setShowMembersModal(true);
          }}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '20px',
              maxWidth: '400px',
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* プロフィールヘッダー */}
            <div style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              padding: '2rem 1.5rem',
              textAlign: 'center',
              position: 'relative'
            }}>
              <button
                onClick={() => {
                  setShowMemberProfile(false);
                  setShowMembersModal(true);
                }}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  left: '1rem',
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  borderRadius: '50%',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  width: '36px',
                  height: '36px'
                }}
              >
                <i className="fas fa-arrow-left"></i>
              </button>

              <div style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: selectedMember.avatar_url ? 'white' : (selectedMember.role === 'parent' ? 'linear-gradient(135deg, #667eea 0%, #d97706 100%)' : 'linear-gradient(135deg, #4fc3f7 0%, #2196f3 100%)'),
                margin: '0 auto 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: '700',
                fontSize: '2.5rem',
                overflow: 'hidden',
                border: '4px solid rgba(255,255,255,0.3)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                position: 'relative'
              }}>
                {selectedMember.avatar_url ? (
                  <img 
                    src={selectedMember.avatar_url} 
                    alt={selectedMember.name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                ) : (
                  selectedMember.role === 'parent' ? 'P' : 'C'
                )}
                
                {/* オンライン状態インジケーター */}
                <div style={{
                  position: 'absolute',
                  bottom: '4px',
                  right: '4px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: onlineStatus[selectedMember.id] === 'online' ? '#06d6a0' : '#8e9aaf',
                  border: '4px solid white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}></div>
              </div>

              <h2 style={{color: 'white', margin: '0 0 0.5rem 0', fontSize: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}}>
                {selectedMember.name}
                {selectedMember.id === groupInfo?.created_by && <span>👑</span>}
              </h2>
              
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}}>
                <span style={{
                  background: 'rgba(255,255,255,0.3)',
                  color: 'white',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  fontWeight: '600'
                }}>
                  {selectedMember.role === 'parent' ? '保護者' : '子供'}
                </span>
                <span style={{
                  background: onlineStatus[selectedMember.id] === 'online' ? 'rgba(6, 214, 160, 0.3)' : 'rgba(142, 154, 175, 0.3)',
                  color: 'white',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  fontWeight: '600'
                }}>
                  {onlineStatus[selectedMember.id] === 'online' ? 'オンライン' : 'オフライン'}
                </span>
              </div>
            </div>

            {/* プロフィール詳細 */}
            <div style={{padding: '1.5rem'}}>
              {selectedMember.bio && (
                <div style={{marginBottom: '1.5rem'}}>
                  <h3 style={{
                    fontSize: '0.85rem',
                    color: '#718096',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '0.5rem',
                    fontWeight: '700'
                  }}>自己紹介</h3>
                  <p style={{
                    fontSize: '0.95rem',
                    color: '#2d3748',
                    lineHeight: '1.6',
                    margin: 0
                  }}>{selectedMember.bio}</p>
                </div>
              )}

              {selectedMember.location && (
                <div style={{marginBottom: '1.5rem'}}>
                  <h3 style={{
                    fontSize: '0.85rem',
                    color: '#718096',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '0.5rem',
                    fontWeight: '700'
                  }}>地域</h3>
                  <p style={{
                    fontSize: '0.95rem',
                    color: '#2d3748',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <i className="fas fa-map-marker-alt" style={{color: '#667eea'}}></i>
                    {selectedMember.location}
                  </p>
                </div>
              )}

              {!selectedMember.bio && !selectedMember.location && (
                <div style={{
                  padding: '2rem 1rem',
                  textAlign: 'center',
                  color: '#a0aec0',
                  fontSize: '0.9rem'
                }}>
                  プロフィール情報が登録されていません
                </div>
              )}

              <div style={{
                background: '#f8f9fa',
                borderRadius: '12px',
                padding: '1rem',
                display: 'flex',
                justifyContent: 'space-around',
                marginTop: '1.5rem'
              }}>
                <div style={{textAlign: 'center'}}>
                  <div style={{fontSize: '1.5rem', fontWeight: '700', color: '#667eea'}}>
                    {groupMessages.filter(m => m.userId === selectedMember.id).length}
                  </div>
                  <div style={{fontSize: '0.75rem', color: '#718096', marginTop: '0.25rem'}}>
                    メッセージ
                  </div>
                </div>
                <div style={{
                  width: '1px',
                  background: '#e9ecef'
                }}></div>
                <div style={{textAlign: 'center'}}>
                  <div style={{fontSize: '1.5rem', fontWeight: '700', color: '#667eea'}}>
                    {selectedMember.id === currentUser.id ? 'あなた' : 'メンバー'}
                  </div>
                  <div style={{fontSize: '0.75rem', color: '#718096', marginTop: '0.25rem'}}>
                    役割
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* グループ削除確認モーダル */}
      {showDeleteConfirm && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-content">
            <div className="confirm-modal-icon danger">
              <i className="fas fa-trash-alt"></i>
            </div>
            <h2>グループを削除</h2>
            <p>本当にこのグループを削除しますか?</p>
            <p>すべてのメッセージと履歴が削除されます。</p>
            <p style={{color: '#ef4444', fontWeight: '600'}}>この操作は取り消せません。</p>
            <div className="confirm-modal-actions">
              <button
                className="confirm-modal-btn cancel"
                onClick={() => setShowDeleteConfirm(false)}
              >
                キャンセル
              </button>
              <button
                className="confirm-modal-btn confirm"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  deleteGroup();
                }}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* グループ退出確認モーダル */}
      {showLeaveConfirm && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-content">
            <div className="confirm-modal-icon warning">
              <i className="fas fa-sign-out-alt"></i>
            </div>
            <h2>グループから退出</h2>
            <p>本当にこのグループから退出しますか?</p>
            <p>再度参加するには、管理者の招待が必要です。</p>
            <div className="confirm-modal-actions">
              <button
                className="confirm-modal-btn cancel"
                onClick={() => setShowLeaveConfirm(false)}
              >
                キャンセル
              </button>
              <button
                className="confirm-modal-btn confirm warning"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  leaveGroup();
                }}
              >
                退出する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 管理者譲渡モーダル */}
      {showTransferAdmin && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-content">
            <div className="confirm-modal-icon" style={{color: '#667eea'}}>
              <i className="fas fa-user-crown"></i>
            </div>
            <h2>管理者を譲渡</h2>
            <p>新しい管理者を選択してください</p>
            <div style={{marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
              {groupMembers.filter(m => m.id !== currentUser.id).map(member => (
                <button
                  key={member.id}
                  onClick={() => {
                    if (confirm(`${member.name}に管理者権限を譲渡しますか?`)) {
                      transferAdmin(member.id);
                    }
                  }}
                  style={{
                    padding: '1rem',
                    background: '#f8f9fa',
                    border: '2px solid #e9ecef',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#667eea';
                    e.currentTarget.style.background = '#f0f4ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e9ecef';
                    e.currentTarget.style.background = '#f8f9fa';
                  }}
                >
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: member.role === 'parent' ? '#667eea' : '#667eea',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '700'
                  }}>
                    {member.role === 'parent' ? 'P' : 'C'}
                  </div>
                  <div style={{flex: 1, textAlign: 'left'}}>
                    <div>{member.name}</div>
                    <div style={{fontSize: '0.85rem', color: '#666'}}>
                      {member.role === 'parent' ? '保護者' : '子供'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              className="confirm-modal-btn cancel"
              onClick={() => setShowTransferAdmin(false)}
              style={{marginTop: '1rem', width: '100%'}}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// GPS追跡開始（親が子供のGPSを遠隔制御）
const startGPSTracking = async (memberId) => {
  try {
    await supabase
      .from('members')
      .update({ gps_enabled: true })
      .eq('id', memberId);
    
    setMembers(prev => prev.map(m => 
      m.id === memberId ? { ...m, gpsActive: true, isMoving: true } : m
    ));
    
    if (Notification.permission === 'granted') {
      const member = members.find(m => m.id === memberId);
      new Notification('Family Safe', {
        body: `${member?.name || '子供'}のGPS追跡を開始しました`
      });
    }
  } catch (error) {
    console.error('GPS start error:', error);
    alert('GPS追跡の開始に失敗しました');
  }
};

// GPS追跡停止（親のみ）
const stopGPSTracking = async (memberId) => {
  try {
    console.log('Stopping GPS for member:', memberId);
    
    const { error } = await supabase
      .from('members')
      .update({ gps_enabled: false })
      .eq('id', memberId);
    
    if (error) {
      console.error('Stop GPS error:', error);
      alert('GPS追跡の停止に失敗しました');
      return;
    }
    
    setMembers(prev => prev.map(m => 
      m.id === memberId ? { ...m, gpsActive: false, isMoving: false } : m
    ));
    
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setGpsEnabled(false);
    }
    
    console.log('GPS stopped successfully');
  } catch (error) {
    console.error('GPS stop error:', error);
    alert('GPS追跡の停止に失敗しました');
  }
};

// 子供側のGPS追跡開始
const startChildGPSTracking = async () => {
  const myProfile = members.find(m => m.userId === currentUser?.id);
  if (!myProfile) return;

  if (!navigator.geolocation) {
    alert('お使いのブラウザは位置情報に対応していません');
    return;
  }

  await supabase
    .from('members')
    .update({ gps_enabled: true })
    .eq('id', myProfile.id);

  const id = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      
      try {
        await supabase
          .from('location_history')
          .insert([{
            member_id: myProfile.id,
            latitude,
            longitude,
            address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`
          }]);
        
        await supabase
          .from('members')
          .update({
            latitude,
            longitude,
            address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`,
            last_update: new Date().toISOString(),
            battery: batteryLevel
          })
          .eq('id', myProfile.id);
        
        setMembers(prev => prev.map(m => 
          m.id === myProfile.id ? {
            ...m,
            location: {
              lat: latitude,
              lng: longitude,
              address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`
            },
            lastUpdate: new Date(),
            isMoving: true,
            battery: batteryLevel
          } : m
        ));
        
        setGpsEnabled(true);
      } catch (error) {
        console.error('GPS update error:', error);
      }
    },
    (error) => {
      console.error('GPS Error:', error.code, error.message);
      if (error.code === 1) {
        alert('位置情報の許可が必要です');
      }
    },
    { 
      enableHighAccuracy: true, 
      timeout: 30000,
      maximumAge: 5000
    }
  );
  
  watchIdRef.current = id;
};

  // 位置情報を一度だけ更新
  const updateLocationOnce = async (memberId) => {
  if (!navigator.geolocation) {
    alert('お使いのブラウザは位置情報に対応していません');
    return;
  }

  console.log('[GPS] Getting current position for member:', memberId);

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      
      console.log('[GPS] Position obtained:', { latitude, longitude });
      
      try {
        // 位置履歴に追加
        await supabase
          .from('location_history')
          .insert([{
            member_id: memberId,
            latitude,
            longitude,
            address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`
          }]);
        
        // メンバー情報を更新
        const { error: updateError } = await supabase
          .from('members')
          .update({
            latitude,
            longitude,
            address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`,
            last_update: new Date().toISOString(),
            battery: batteryLevel
          })
          .eq('id', memberId);
        
        if (updateError) {
          console.error('[GPS] Update error:', updateError);
          alert('位置情報の更新に失敗しました: ' + updateError.message);
          return;
        }
        
        console.log('[GPS] Database updated successfully');
        
        // 状態を即座に更新
        setMembers(prev => prev.map(m => 
          m.id === memberId ? {
            ...m,
            location: {
              lat: latitude,
              lng: longitude,
              address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`
            },
            lastUpdate: new Date(),
            battery: batteryLevel
          } : m
        ));
        
        console.log('[GPS] State updated, new position:', { latitude, longitude });
        alert('位置情報を更新しました');
      } catch (error) {
        console.error('[GPS] Location update error:', error);
        alert('位置情報の更新に失敗しました');
      }
    },
    (error) => {
      console.error('[GPS] Error:', error);
      if (error.code === error.PERMISSION_DENIED) {
        alert('位置情報の許可が必要です。ブラウザの設定で位置情報を許可してください。');
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        alert('位置情報を取得できません。GPS機能を確認してください。');
      } else if (error.code === error.TIMEOUT) {
        alert('位置情報の取得がタイムアウトしました。もう一度試してください。');
      } else {
        alert('位置情報の取得に失敗しました: ' + error.message);
      }
    },
    { 
      enableHighAccuracy: true, 
      timeout: 15000, 
      maximumAge: 0 
    }
  );
};

  // 距離計算
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

const ProfileScreen = () => {
  const [uploading, setUploading] = useState(false);

  const uploadAvatar = async (event) => {
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('画像を選択してください');
      }

      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}-${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      // 古い画像を削除
      if (currentUser.avatar_url) {
        const oldPath = currentUser.avatar_url.split('/').pop();
        await supabase.storage.from('avatars').remove([oldPath]);
      }

      // 新しい画像をアップロード
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // 公開URLを取得
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);

      // プロフィールを更新
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: data.publicUrl })
        .eq('id', currentUser.id);

      if (updateError) {
        throw updateError;
      }

      setCurrentUser({ ...currentUser, avatar_url: data.publicUrl });
      alert('プロフィール画像を更新しました！');
    } catch (error) {
      console.error('Upload error:', error);
      alert('画像のアップロードに失敗しました: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="register-screen">
      <div className="register-container">
        <div className="register-hero">
          <div className="register-icon" style={{position: 'relative'}}>
            {currentUser.avatar_url ? (
              <img 
                src={currentUser.avatar_url} 
                alt="Avatar" 
                style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '4px solid white',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}
              />
            ) : (
              <div style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '3rem',
                fontWeight: '700'
              }}>
                {currentUser?.avatar || currentUser?.name?.charAt(0) || 'U'}
              </div>
            )}
            <label style={{
              position: 'absolute',
              bottom: '10px',
              right: '10px',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: '#667eea',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: uploading ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              border: '3px solid white'
            }}>
              <i className="fas fa-camera" style={{color: 'white', fontSize: '1.2rem'}}></i>
              <input
                type="file"
                accept="image/*"
                onChange={uploadAvatar}
                disabled={uploading}
                style={{display: 'none'}}
              />
            </label>
          </div>
          <h1>設定</h1>
          <p>プロフィール情報</p>
          {uploading && (
            <p style={{color: '#667eea', fontSize: '0.9rem', marginTop: '0.5rem'}}>
              <i className="fas fa-spinner fa-spin"></i> アップロード中...
            </p>
          )}
        </div>

        <div className="register-form">
          <div className="form-group">
            <label>名前</label>
            <div style={{
              padding: '1rem',
              background: '#f8f9fa',
              borderRadius: '12px',
              border: '2px solid #e9ecef',
              fontSize: '1rem',
              color: '#333',
              fontWeight: '500'
            }}>
              {currentUser?.name}
            </div>
          </div>

          <div className="form-group">
            <label>メールアドレス</label>
            <div style={{
              padding: '1rem',
              background: '#f8f9fa',
              borderRadius: '12px',
              border: '2px solid #e9ecef',
              fontSize: '1rem',
              color: '#333',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <Mail size={18} style={{color: '#667eea'}} />
              {currentUser?.email}
            </div>
          </div>

          <div className="form-group">
            <label>アカウント種別</label>
            <div style={{
              padding: '1rem',
              background: '#f8f9fa',
              borderRadius: '12px',
              border: '2px solid #e9ecef',
              fontSize: '1rem',
              color: '#333',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              {currentUser?.role === 'parent' ? (
                <>
                  <i className="fas fa-user-shield" style={{color: '#667eea'}}></i>
                  保護者
                </>
              ) : (
                <>
                  <i className="fas fa-child" style={{color: '#667eea'}}></i>
                  子供
                </>
              )}
            </div>
          </div>

          {currentUser?.phone && (
            <div className="form-group">
              <label>電話番号</label>
              <div style={{
                padding: '1rem',
                background: '#f8f9fa',
                borderRadius: '12px',
                border: '2px solid #e9ecef',
                fontSize: '1rem',
                color: '#333',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Phone size={18} style={{color: '#667eea'}} />
                {currentUser.phone}
              </div>
            </div>
          )}

          <button 
            onClick={() => setCurrentView(currentUser?.role === 'parent' ? 'parent-dashboard' : 'child-dashboard')}
            className="register-btn primary"
            style={{
              marginTop: '1rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              padding: '1rem',
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
          >
            <i className="fas fa-arrow-left"></i>
            戻る
          </button>
        </div>
      </div>
    </div>
  );
};

  // ログイン画面
  const LoginScreen = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleLogin = async () => {
      if (!email || !password) {
        setError('メールアドレスとパスワードを入力してください');
        return;
      }

      setLoading(true);
      setError('');

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      setLoading(false);

      if (signInError) {
        setError(signInError.message === 'Invalid login credentials' 
          ? 'メールアドレスまたはパスワードが正しくありません'
          : signInError.message);
      }
    };

    const handleGoogleLogin = async () => {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        }
      });

      if (error) {
        setError('Googleログインに失敗しました: ' + error.message);
        setLoading(false);
      }
    };

    const handleLineLogin = async () => {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'line',
        options: {
          redirectTo: window.location.origin,
        }
      });

      if (error) {
        setError('LINEログインに失敗しました: ' + error.message);
        setLoading(false);
      }
    };

    return (
      <div className="login-screen">
        <div className="login-container">
          <div className="login-hero">
            <div className="login-icon">
              <Shield size={64} />
            </div>
            <h1>Family Safe</h1>
            <p>家族の安心を見守るアプリ</p>
          </div>

          <div className="social-login">
            <button 
              onClick={handleGoogleLogin} 
              className="social-btn google-btn"
              disabled={loading}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Googleでログイン
            </button>

            <button 
              onClick={handleLineLogin} 
              className="social-btn line-btn"
              disabled={loading}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
              </svg>
              LINEでログイン
            </button>
          </div>

          <div className="divider">
            <span>または</span>
          </div>

          <div className="login-form">
            <div className="form-group">
              <label htmlFor="email">メールアドレス</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="example@email.com"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">パスワード</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="パスワードを入力"
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button 
              onClick={handleLogin} 
              className="login-btn primary"
              disabled={loading}
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>

            <div className="login-footer">
              <span>アカウントをお持ちでない方</span>
              <button 
                onClick={() => setCurrentView('register')} 
                className="link-btn"
                disabled={loading}
              >
                新規登録
              </button>
            </div>
            {/* QRコードで登録ボタン */}
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: '#f8f9fa',
              borderRadius: '12px',
              textAlign: 'center',
              border: '2px dashed #667eea'
            }}>
              <p style={{
                fontSize: '0.85rem',
                color: '#666',
                margin: '0 0 0.75rem 0'
              }}>
                📱 スマホで登録する場合
              </p>
              <button
                onClick={() => setCurrentView('qr-register')}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '1rem',
                  width: '100%'
                }}
                disabled={loading}
              >
                📷 QRコードを表示する
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // QRコード登録画面（PCで表示 → スマホで読み取り）
  const QRRegisterScreen = () => {
    const [copied, setCopied] = React.useState(false);

    // このアプリのURL（スマホが開く先）
    const registerUrl = window.location.origin + window.location.pathname + '#register';

    // URLをコピー
    const copyUrl = async () => {
      try {
        await navigator.clipboard.writeText(registerUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        alert('コピーに失敗しました。URLを手動でコピーしてください。');
      }
    };

    // スマホ共有（LINEやメールで送れる）
    const shareUrl = async () => {
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Family Safe - 新規登録',
            text: 'Family Safeに登録しましょう！',
            url: registerUrl,
          });
        } catch (e) {
          console.log('Share cancelled');
        }
      } else {
        copyUrl();
      }
    };

    return (
      <div className="register-screen">
        <div className="register-container">
          <div className="register-hero">
            <div className="register-icon">
              <span style={{fontSize: '4rem'}}>📷</span>
            </div>
            <h1>QRコードで登録</h1>
            <p>スマホでQRコードを読み取ってください</p>
          </div>

          <div className="register-form">
            {/* 使い方説明 */}
            <div style={{
              background: '#E3F2FD',
              padding: '1rem',
              borderRadius: '12px',
              marginBottom: '1.5rem',
              border: '1px solid #90CAF9'
            }}>
              <p style={{margin: 0, fontSize: '0.9rem', color: '#1565C0'}}>
                <strong>使い方：</strong><br/>
                1️⃣ スマホのカメラでQRコードを読み取る<br/>
                2️⃣ 自動でブラウザが開く<br/>
                3️⃣ そのまま新規登録できます！
              </p>
            </div>

            {/* QRコード表示 */}
            <div style={{
              textAlign: 'center',
              padding: '1.5rem',
              background: 'white',
              borderRadius: '16px',
              border: '2px solid #e9ecef',
              marginBottom: '1.5rem'
            }}>
              <QRCodeCanvas
                value={registerUrl}
                size={250}
                bgColor="#ffffff"
                fgColor="#667eea"
                level="M"
                includeMargin={true}
              />
              {/* QRコード読み込み失敗時のフォールバック */}
              <div style={{display: 'none', padding: '2rem', color: '#999'}}>
                QRコードの読み込みに失敗しました。<br/>
                下のURLをスマホに送ってください。
              </div>
              <p style={{
                fontSize: '0.8rem',
                color: '#999',
                marginTop: '1rem',
                marginBottom: 0
              }}>
                スマホのカメラで読み取ってください
              </p>
            </div>

            {/* URLを直接コピー */}
            <div style={{marginBottom: '1rem'}}>
              <p style={{
                fontSize: '0.85rem',
                color: '#666',
                marginBottom: '0.5rem'
              }}>
                💡 QRコードが読めない場合は、このURLをLINEやメールで送ってください：
              </p>
              <div style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center'
              }}>
                <div style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e9ecef',
                  fontSize: '0.8rem',
                  color: '#333',
                  wordBreak: 'break-all',
                  fontFamily: 'monospace'
                }}>
                  {registerUrl}
                </div>
                <button
                  onClick={copyUrl}
                  style={{
                    padding: '0.75rem 1rem',
                    background: copied ? '#10b981' : '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                    fontSize: '0.9rem'
                  }}
                >
                  {copied ? '✅ コピー済' : '📋 コピー'}
                </button>
              </div>
            </div>

            {/* 共有ボタン（スマホの場合はネイティブ共有） */}
            <button
              onClick={shareUrl}
              style={{
                width: '100%',
                padding: '1rem',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem'
              }}
            >
              📤 URLを共有する（LINE・メール等）
            </button>

            {/* 戻るボタン */}
            <button
              onClick={() => setCurrentView('login')}
              className="register-btn"
              style={{
                width: '100%',
                padding: '0.875rem',
                background: '#f8f9fa',
                color: '#667eea',
                border: '2px solid #667eea',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              ← ログイン画面に戻る
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 新規登録画面
  const RegisterScreen = () => {
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: 'parent',
      phone: ''
    });
    const [error, setError] = useState('');

    const handleRegister = async () => {
      if (!formData.name || !formData.email || !formData.password) {
        setError('すべての必須項目を入力してください');
        return;
      }

      if (formData.password !== formData.confirmPassword) {
        setError('パスワードが一致しません');
        return;
      }

      if (formData.password.length < 6) {
        setError('パスワードは6文字以上で入力してください');
        return;
      }

      setLoading(true);
      setError('');

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (authData.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert([{
            id: authData.user.id,
            name: formData.name,
            role: formData.role,
            phone: formData.phone,
            email: formData.email,
          }]);

        if (profileError) {
          setError('プロファイルの保存に失敗しました');
          setLoading(false);
          return;
        }

        if (formData.role === 'child') {
          await supabase.from('members').insert([{
            user_id: authData.user.id,
            name: formData.name,
            status: 'safe',
            battery: batteryLevel,
            gps_active: false
          }]);
        }

        alert('登録が完了しました！');
        setCurrentView('login');
      }

      setLoading(false);
    };

    return (
      <div className="register-screen">
        <div className="register-container">
          <div className="register-hero">
            <div className="register-icon">
              <User size={64} />
            </div>
            <h1>新規登録</h1>
            <p>Family Safe アカウントを作成</p>
          </div>

          <div className="register-form">
            <div className="form-group">
              <label htmlFor="role">アカウント種別</label>
              <select
                id="role"
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value})}
                disabled={loading}
              >
                <option value="parent">保護者</option>
                <option value="child">子供</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="name">名前</label>
              <input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="山田太郎"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reg-email">メールアドレス</label>
              <input
                id="reg-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="example@email.com"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">電話番号（任意）</label>
              <input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                placeholder="090-1234-5678"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reg-password">パスワード</label>
              <input
                id="reg-password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                placeholder="6文字以上"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password">パスワード確認</label>
              <input
                id="confirm-password"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                onKeyPress={(e) => e.key === 'Enter' && handleRegister()}
                placeholder="パスワードを再入力"
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button 
              onClick={handleRegister} 
              className="register-btn primary"
              disabled={loading}
            >
              {loading ? '登録中...' : 'アカウントを作成'}
            </button>

            <div className="register-footer">
              <span>既にアカウントをお持ちの方</span>
              <button 
                onClick={() => setCurrentView('login')} 
                className="link-btn"
                disabled={loading}
              >
                ログイン
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ロール選択画面
  const RoleSelectionScreen = () => {
    const [selectedRole, setSelectedRole] = useState('parent');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');

    const handleComplete = async () => {
      if (!name.trim()) {
        setError('名前を入力してください');
        return;
      }

      setLoading(true);
      setError('');

      const { error: profileError } = await supabase
        .from('profiles')
        .insert([{
          id: currentUser.id,
          name: name,
          role: selectedRole,
          phone: phone,
          email: currentUser.email,
        }]);

      if (profileError) {
        setError('登録に失敗しました: ' + profileError.message);
        setLoading(false);
        return;
      }

      if (selectedRole === 'child') {
        await supabase.from('members').insert([{
          user_id: currentUser.id,
          name: name,
          status: 'safe',
          battery: batteryLevel,
          gps_active: false
        }]);
      }

      const { data: session } = await supabase.auth.getSession();
      if (session?.session?.user) {
        loadUserProfile(session.session.user);
      }

      setLoading(false);
    };

    return (
      <div className="register-screen">
        <div className="register-container">
          <div className="register-hero">
            <div className="register-icon">
              <Users size={64} />
            </div>
            <h1>アカウント情報を設定</h1>
            <p>アカウントの設定を完了してください</p>
          </div>

          <div className="register-form">
            <div style={{background: '#FFF3CD', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid #FFE69C'}}>
              <p style={{fontSize: '0.9rem', color: '#856404', margin: 0, display: 'flex', alignItems: 'start', gap: '0.5rem'}}>
                <span style={{fontSize: '1.2rem'}}>
                  <i className="fas fa-info-circle"></i>
                </span>
                <span>
                  <strong>プロファイル情報が見つかりません。</strong><br/>
                  アカウントタイプと名前を設定して、登録を完了してください。
                </span>
              </p>
            </div>

            <div style={{background: '#E3F2FD', padding: '1rem', borderRadius: '12px', marginBottom: '1rem'}}>
              <p style={{fontSize: '0.9rem', color: '#1976D2', margin: 0}}>
                <i className="far fa-envelope"></i> {currentUser?.email}
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="role">アカウント種別</label>
              <select
                id="role"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                disabled={loading}
              >
                <option value="parent">保護者</option>
                <option value="child">子供</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="name">名前</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="山田太郎"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">電話番号（任意）</label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="090-1234-5678"
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button 
              onClick={handleComplete} 
              className="register-btn primary"
              disabled={loading}
            >
              {loading ? '登録中...' : '設定を完了'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 子供追加画面
  const AddChildScreen = () => {
    const [childId, setChildId] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleAddChild = async () => {
      if (!childId.trim()) {
        setError('子供のユーザーIDを入力してください');
        return;
      }

      setLoading(true);
      setError('');
      setSuccess('');

      const trimmedId = childId.trim();
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(trimmedId)) {
        setError('❌ 無効なID形式\n\n入力: ' + trimmedId + '\n文字数: ' + trimmedId.length + '/36');
        setLoading(false);
        return;
      }

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', trimmedId)
          .maybeSingle();

        if (profileError) {
          setError('データベースエラー\n\nコード: ' + profileError.code + '\nメッセージ: ' + profileError.message);
          setLoading(false);
          return;
        }

        if (!profile) {
          setError('⚠️ プロファイル未登録\n\n子供アカウントで以下を実行:\n1. ログアウト\n2. 再ログイン\n3. 「子供」を選択\n4. 名前入力して完了\n\n入力ID:\n' + trimmedId);
          setLoading(false);
          return;
        }

        if (profile.role !== 'child') {
          setError('⚠️ ロール不一致\n\n名前: ' + profile.name + '\nロール: ' + profile.role + '\n必要: child');
          setLoading(false);
          return;
        }

        const { data: existing } = await supabase
          .from('parent_children')
          .select('*')
          .eq('parent_id', currentUser.id)
          .eq('child_id', trimmedId)
          .maybeSingle();

        if (existing) {
          setError(profile.name + ' は既に登録済みです');
          setLoading(false);
          return;
        }

        const { error: insertError } = await supabase
          .from('parent_children')
          .insert([{
            parent_id: currentUser.id,
            child_id: trimmedId
          }]);

        if (insertError) {
          setError('登録失敗: ' + insertError.message);
          setLoading(false);
          return;
        }

        setSuccess('✅ ' + profile.name + ' を登録しました！');
        setChildId('');
        
        await loadMembersData(currentUser);
        
        setTimeout(() => {
          setCurrentView('parent-dashboard');
        }, 1500);

      } catch (error) {
        setError('予期しないエラー\n\n' + error.message);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="register-screen">
        <div className="register-container">
          <div className="register-hero">
            <div className="register-icon">
              <Users size={64} />
            </div>
            <h1>子供を追加</h1>
            <p>子供のユーザーIDを入力してください</p>
          </div>

          <div className="register-form">
            <div style={{background: '#E3F2FD', padding: '1rem', borderRadius: '12px', marginBottom: '1rem'}}>
              <p style={{fontSize: '0.9rem', color: '#1976D2', margin: 0}}>
                <i className="fas fa-info-circle"></i> 子供アカウントのユーザーIDは、子供のプロフィール画面で確認できます。
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="child-id">子供のユーザーID</label>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <input
                  id="child-id"
                  type="text"
                  value={childId}
                  onChange={(e) => setChildId(e.target.value)}
                  placeholder="例: 550e8400-e29b-41d4-a716-446655440000"
                  disabled={loading}
                  style={{flex: 1, fontFamily: 'monospace', fontSize: '0.9rem'}}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setChildId(text.trim());
                    } catch (err) {
                      alert('クリップボードからの読み取りに失敗しました');
                    }
                  }}
                  disabled={loading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <i className="far fa-clipboard"></i> 貼り付け
                </button>
              </div>
            </div>

            {error && <div className="error-message" style={{whiteSpace: 'pre-line', textAlign: 'left'}}>{error}</div>}
            {success && <div className="success-message" style={{whiteSpace: 'pre-line'}}>{success}</div>}

            <button 
              onClick={handleAddChild} 
              className="register-btn primary"
              disabled={loading}
            >
              {loading ? '登録中...' : '子供を追加'}
            </button>

            <div className="register-footer">
              <button 
                onClick={() => setCurrentView('parent-dashboard')} 
                className="link-btn"
                disabled={loading}
              >
                ダッシュボードに戻る
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

const ParentDashboard = () => {
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [activeTab, setActiveTab] = useState('map');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showMemberManagement, setShowMemberManagement] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    time: '',
    type: 'departure',
    location: ''
  });

  // 絵文字リスト
  const emojis = ['😀', '😂', '🥰', '😍', '🤔', '😅', '😊', '👍', '❤️', '🎉', '🔥', '✨', '💯', '👏', '🙏', '😭', '😱', '🤗', '😎', '🥳', '😴', '🤪', '💪', '👌', '✌️', '🙌', '👋', '💕', '💖', '🌟'];

    const addEmoji = (emoji) => {
    if (editingMessageId) {
      setEditingMessageText(prev => prev + emoji);
    } else {
      setNewMessage(prev => prev + emoji);
    }
  };

  // メッセージ削除
  const deleteMessage = async (messageId) => {
    if (!confirm('このメッセージを削除しますか？')) return;

    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);

      if (error) {
        console.error('Delete message error:', error);
        alert('メッセージの削除に失敗しました');
        return;
      }

      setMessages(prev => prev.filter(m => m.id !== messageId));
      setShowMessageMenu(null);
    } catch (error) {
      console.error('Delete message error:', error);
      alert('メッセージの削除に失敗しました');
    }
  };

  // メッセージ編集開始
  const startEditMessage = (message) => {
    setEditingMessageId(message.id);
    setEditingMessageText(message.text);
    setShowMessageMenu(null);
  };

  // メッセージ編集キャンセル
  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
  };

  // メッセージ編集保存
  const saveEditMessage = async () => {
    if (!editingMessageText.trim() || !editingMessageId) return;

    try {
      const { error } = await supabase
        .from('messages')
        .update({ 
          text: editingMessageText,
          edited: true,
          edited_at: new Date().toISOString()
        })
        .eq('id', editingMessageId);

      if (error) {
        console.error('Edit message error:', error);
        alert('メッセージの編集に失敗しました');
        return;
      }

      setMessages(prev => prev.map(m => 
        m.id === editingMessageId ? {
          ...m,
          text: editingMessageText,
          edited: true,
          editedAt: new Date()
        } : m
      ));

      setEditingMessageId(null);
      setEditingMessageText('');
    } catch (error) {
      console.error('Edit message error:', error);
      alert('メッセージの編集に失敗しました');
    }
  };

  const myChildren = members;
  const unreadAlerts = alerts.filter(a => !a.read).length;
  const unreadMessages = useMemo(() => {
    return messages.filter(m => m.to === currentUser?.id && !m.read).length;
  }, [messages, currentUser?.id]);
  const displayMember = useMemo(() => {
      if (selectedMemberId) {
        return members.find(m => m.id === selectedMemberId) || null;
      }
      return members[0] || null;
    }, [selectedMemberId, members]);

useEffect(() => {
  if (activeTab !== 'map' || !displayMember || typeof window.L === 'undefined') {
    return;
  }

  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;
  
  mapContainer.innerHTML = '';

  const map = window.L.map('map').setView(
    [displayMember.location.lat, displayMember.location.lng], 
    15
  );

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  // ⭐ プロフィール画像があればそれを使う
  const avatarContent = displayMember.avatarUrl 
    ? `<img src="${displayMember.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />`
    : `<span style="color: #667eea; font-weight: 700; font-size: 20px;">${displayMember.avatar}</span>`;

  const customIcon = window.L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative; width: 60px; height: 80px; transform: translateX(-50%);">
        <!-- アバター部分（円形） -->
        <div style="
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 50px;
          height: 50px;
          background: white;
          border: 3px solid #667eea;
          border-radius: 50%;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          z-index: 2;
        ">
          ${avatarContent}
        </div>
        
        <!-- ピンの三角部分 -->
        <div style="
          position: absolute;
          top: 50px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 10px solid transparent;
          border-right: 10px solid transparent;
          border-top: 24px solid #667eea;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
          z-index: 1;
        "></div>
      </div>
    `,
    iconSize: [60, 74],
    iconAnchor: [30, 74]
  });

  const marker = window.L.marker(
    [displayMember.location.lat, displayMember.location.lng],
    { icon: customIcon }
  ).addTo(map);

  // ⭐ クリックで詳細ポップアップを表示
  marker.bindPopup(`
    <div style="text-align: center; padding: 0.75rem; min-width: 200px;">
      <strong style="font-size: 1.2rem; color: #333;">${displayMember.name}</strong><br/>
      <span style="color: #999; font-size: 0.85rem; margin-top: 0.25rem; display: block;">
        ${displayMember.lastUpdate.toLocaleString('ja-JP', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </span>
      <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #e9ecef; text-align: left;">
        <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
          <strong>状態:</strong> 
          <span style="
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.85rem;
            font-weight: 600;
            ${displayMember.status === 'safe' ? 'background: #d1fae5; color: #065f46;' : 
              displayMember.status === 'warning' ? 'background: #fef3c7; color: #92400e;' : 
              'background: #fee2e2; color: #991b1b;'}
          ">
            <span style="
              width: 8px;
              height: 8px;
              border-radius: 50%;
              ${displayMember.status === 'safe' ? 'background: #10b981;' : 
                displayMember.status === 'warning' ? 'background: #667eea;' : 
                'background: #ef4444;'}
            "></span>
            ${displayMember.status === 'safe' ? '安全' : 
              displayMember.status === 'warning' ? '道に迷ってる' : 
              '緊急'}
          </span>
        </div>
        <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.5rem;">
          <strong>位置:</strong> ${displayMember.location.address}
        </div>
        <div style="font-size: 0.9rem; color: #666;">
          <strong>バッテリー:</strong> ${displayMember.battery}%
        </div>
      </div>
      <button 
        onclick="document.getElementById('map').dispatchEvent(new CustomEvent('closePopup'))"
        style="
          margin-top: 1rem;
          width: 100%;
          padding: 0.6rem;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.95rem;
          transition: all 0.2s;
        "
        onmouseover="this.style.background='#5568d3'"
        onmouseout="this.style.background='#667eea'"
      >
        閉じる
      </button>
    </div>
  `);

  // ポップアップを閉じるイベント
  mapContainer.addEventListener('closePopup', () => {
    map.closePopup();
  });

  return () => {
    map.remove();
  };
}, [activeTab, displayMember?.location.lat, displayMember?.location.lng, displayMember?.name, displayMember?.avatar, displayMember?.avatarUrl, displayMember?.lastUpdate, displayMember?.location.address, displayMember?.battery, displayMember?.status]);

    useEffect(() => {
      if (!selectedMemberId && members.length > 0) {
        setSelectedMemberId(members[0].id);
      }
    }, [members.length, selectedMemberId]);

const sendMessage = async () => {
  if (!newMessage.trim() || !displayMember) return;
  
  const messageText = newMessage;
  const tempId = 'temp-' + Date.now();
  const timestamp = new Date();
  
  // 楽観的UI更新（即座に表示）
  const optimisticMessage = {
    id: tempId,
    from: currentUser.id,
    to: displayMember.userId,
    text: messageText,
    timestamp: timestamp,
    read: false
  };
  
  setMessages(prev => [...prev, optimisticMessage]);
  setNewMessage('');
  setShowEmojiPicker(false);
  
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert([{
        from_user_id: currentUser.id,
        to_user_id: displayMember.userId,
        text: messageText,
        read: false
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Send message error:', error);
      alert('メッセージの送信に失敗しました');
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(messageText);
      return;
    }
    
    if (data) {
      setMessages(prev => prev.map(m => 
        m.id === tempId ? {
          id: data.id,
          from: data.from_user_id,
          to: data.to_user_id,
          text: data.text,
          timestamp: new Date(data.created_at),
          read: data.read
        } : m
      ));
    }
  } catch (error) {
    console.error('Send message error:', error);
    setMessages(prev => prev.filter(m => m.id !== tempId));
    setNewMessage(messageText);
  }
};

    const makeCall = (member) => {
      const phoneNumber = member.phone || currentUser.phone;
      if (!phoneNumber) {
        alert('電話番号が登録されていません');
        return;
      }
      window.location.href = 'tel:' + phoneNumber;
    };

    if (dataLoading && myChildren.length === 0) {
      return (
        <div className="dashboard">
          <header className="dashboard-header">
            <div className="header-left">
              <h1>Family Safe</h1>
              <p>{currentUser?.name}</p>
            </div>
          </header>
          <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 100px)', fontSize: '1.2rem', color: '#666'}}>
            <div style={{textAlign: 'center'}}>
              <div style={{width: '50px', height: '50px', border: '4px solid #f3f3f3', borderTop: '4px solid #667eea', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem'}}></div>
              <p>データを読み込んでいます...</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <div className="header-left">
            <h1>Family Safe</h1>
            <p>{currentUser?.name}</p>
          </div>
          <div className="header-right">
            <button className="icon-btn" onClick={() => setCurrentView('group-chat')} title="グループチャット">
              <Users size={20} />
            </button>
             {displayMember && (
          <button 
            className="icon-btn" 
            onClick={() => setShowChat(true)}
            title="メッセージ"
          >
            <MessageCircle size={20} />
            {unreadMessages > 0 && <span className="badge">{unreadMessages}</span>}
          </button>
          )}
            <button className="icon-btn" onClick={() => setCurrentView('profile')}>
              <Settings size={20} />
            </button>
            <button className="icon-btn alert-btn" onClick={() => setActiveTab('alerts')}>
              <Bell size={20} />
              {unreadAlerts > 0 && <span className="badge">{unreadAlerts}</span>}
            </button>
            <button onClick={async () => {
              if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
              }
              await supabase.auth.signOut();
              setCurrentUser(null);
              setCurrentView('login');
            }} className="logout-btn">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="dashboard-main">
          <aside className="members-sidebar">
            <h2>家族メンバー</h2>
            <div className="members-list">
              {myChildren.map(member => (
                <div key={member.id} className={'member-card ' + (selectedMemberId === member.id ? 'active' : '')} onClick={() => setSelectedMemberId(member.id)}>
                  <div className="member-avatar">
                    {member.avatarUrl ? (
                      <img 
                        src={member.avatarUrl} 
                        alt={member.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: '50%',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      member.avatar
                    )}
                  </div>
                  <div className="member-info">
                    <h3>{member.name}</h3>
                    <div className="member-status">
                      <span className={'status-dot ' + member.status}></span>
                      <span className="status-text">
                        {member.status === 'safe' ? '安全' : member.status === 'warning' ? '道に迷ってる' : '緊急'}
                      </span>
                    </div>
                    <div className="member-location">
                      <MapPin size={14} />
                      <span>{member.location.address}</span>
                    </div>
                    {member.gpsActive && (
                      <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem', color: '#10b981', fontSize: '0.75rem'}}>
                        <Navigation size={12} />
                        <span>GPS追跡中</span>
                      </div>
                    )}
                  </div>
                  <div className="member-battery">
                    <Battery size={16} />
                    <span>{member.battery}%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="add-child-section">
              <button className="add-child-btn" onClick={() => setCurrentView('add-child')}>
                <Plus size={18} />
                子供を追加
              </button>
              <button 
                className="add-child-btn" 
                onClick={() => setShowMemberManagement(true)}
                style={{marginTop: '0.5rem', background: '#667eea'}}
              >
                <Users size={18} />
                メンバー管理
              </button>
            </div>
            {displayMember && (
              <div className="quick-actions">
                <button className="action-btn group-btn" onClick={() => setCurrentView('group-list')}>
                  <Users size={18} />
                  グループ
                </button>
                <button className="action-btn chat-btn" onClick={() => setShowChat(true)}>
                  <MessageCircle size={18} />
                  チャット
                </button>
                <button className="action-btn call-btn" onClick={() => makeCall(displayMember)}>
                  <Phone size={18} />
                  電話
                </button>
              </div>
            )}
          </aside>

          <main className="main-content">
            {displayMember ? (
              <>
                <div className="tabs">
                  <button className={'tab ' + (activeTab === 'map' ? 'active' : '')} onClick={() => setActiveTab('map')}>
                    <MapPin size={18} />
                    位置情報
                  </button>
                  <button className={'tab ' + (activeTab === 'schedule' ? 'active' : '')} onClick={() => setActiveTab('schedule')}>
                    <Calendar size={18} />
                    スケジュール
                  </button>
                  <button className={'tab ' + (activeTab === 'activity' ? 'active' : '')} onClick={() => setActiveTab('activity')}>
                    <Activity size={18} />
                    活動履歴
                  </button>
                  <button className={'tab ' + (activeTab === 'alerts' ? 'active' : '')} onClick={() => setActiveTab('alerts')}>
                    <Bell size={18} />
                    アラート
                    {unreadAlerts > 0 && <span className="tab-badge">{unreadAlerts}</span>}
                  </button>
                </div>

<div className="tab-content">
{activeTab === 'map' && (
  <div className="map-container">
    <div className="map-header">
      <h2>{displayMember.name}の現在地</h2>
      <div style={{display: 'flex', gap: '0.5rem'}}>
        {displayMember.status !== 'safe' && (
          <button 
            className="gps-btn"
            onClick={async () => {
              if (!confirm(`${displayMember.name}の状態を「安全」に戻しますか？`)) return;
              
              try {
                const { error } = await supabase
                  .from('members')
                  .update({ status: 'safe' })
                  .eq('id', displayMember.id);
                
                if (error) {
                  console.error('Status update error:', error);
                  alert('状態の更新に失敗しました');
                  return;
                }
                
                setMembers(prev => prev.map(m => 
                  m.id === displayMember.id ? { ...m, status: 'safe' } : m
                ));
                
                alert('状態を「安全」に戻しました');
              } catch (error) {
                console.error('Status update error:', error);
                alert('状態の更新に失敗しました');
              }
            }}
            style={{background: '#10b981' , color: '#fff'}}
          >
            <Check size={16} />
            安全に戻す
          </button>
        )}
        <button className="gps-btn refresh" onClick={() => updateLocationOnce(displayMember.id)}>
          <Clock size={16} />
          更新
        </button>
        <button 
          className={'gps-btn ' + (displayMember.gpsActive ? 'active' : '')}
          onClick={() => displayMember.gpsActive ? stopGPSTracking(displayMember.id) : startGPSTracking(displayMember.id)}
        >
          <Navigation size={16} />
          {displayMember.gpsActive ? 'GPS停止' : 'GPS開始'}
        </button>
      </div>
    </div>

    {/* Leaflet Map */}
    <div style={{position: 'relative'}}>
      <div 
        id="map" 
        style={{
          height: '500px', 
          width: '100%', 
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 1
        }}
      ></div>

      {/* GPS追跡中インジケーター */}
      {displayMember.gpsActive && (
        <div style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: '#10b981',
          color: 'white',
          padding: '0.5rem 1rem',
          borderRadius: '20px',
          fontSize: '0.85rem',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
          zIndex: 1000
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'white',
            animation: 'pulse 2s infinite'
          }}></div>
          GPS追跡中
        </div>
      )}
    </div>

    {/* 情報パネル */}
    <div style={{
      marginTop: '1rem',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '1rem'
    }}>
      <div style={{
        padding: '1rem',
        background: '#f8f9fa',
        borderRadius: '12px'
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem'}}>
          <MapPin size={16} style={{color: '#667eea'}} />
          <span style={{fontSize: '0.85rem', color: '#666'}}>座標</span>
        </div>
        <div style={{fontSize: '0.9rem', fontWeight: '600', color: '#333'}}>
          {displayMember.location.lat.toFixed(6)}°N<br/>
          {displayMember.location.lng.toFixed(6)}°E
        </div>
      </div>

      <div style={{
        padding: '1rem',
        background: '#f8f9fa',
        borderRadius: '12px'
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem'}}>
          <Clock size={16} style={{color: '#667eea'}} />
          <span style={{fontSize: '0.85rem', color: '#666'}}>最終更新</span>
        </div>
        <div style={{fontSize: '0.9rem', fontWeight: '600', color: '#333'}}>
          {displayMember.lastUpdate.toLocaleString('ja-JP', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>
      </div>
    </div>

    <a 
      href={`https://www.google.com/maps?q=${displayMember.location.lat},${displayMember.location.lng}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',   
        marginTop: '1rem',
        padding: '1rem',
        background: 'white',
        border: '2px solid #667eea',
        borderRadius: '12px',
        textDecoration: 'none',
        textAlign: 'center',
        fontWeight: '600',
        color: '#667eea',
        transition: 'all 0.2s'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#667eea';
        e.currentTarget.style.color = 'white';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'white';
        e.currentTarget.style.color = '#667eea';
      }}
    >
      <MapPin size={20} /> 
      Google Mapsアプリで開く
    </a>
  </div>
)}

{activeTab === 'schedule' && (
  <div className="schedule-container">
    <div className="schedule-header">
      <h2>今日のスケジュール</h2>
      <button className="add-btn" onClick={() => setShowScheduleModal(true)}>
        <Plus size={16} />
        追加
      </button>
    </div>

    <div className="schedule-list">
      {displayMember.schedule && displayMember.schedule.length > 0 ? (
        displayMember.schedule.map(item => (
          <div key={item.id} className="schedule-item">
            <div className="schedule-time">{item.time}</div>
            <div className={'schedule-line ' + item.type}></div>
            <div className="schedule-details">
              <h4>{item.title}</h4>
              <p>{item.location}</p>
            </div>
            <div className="schedule-status" style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
              {item.completed ? (
                <Check size={20} className="check-icon" />
              ) : (
                <Clock size={20} className="pending-icon" />
              )}
              <button
                onClick={async () => {
                  if (!confirm('このスケジュールを削除しますか？')) return;
                  try {
                    const { error } = await supabase
                      .from('schedules')
                      .delete()
                      .eq('id', item.id);
                    
                    if (error) {
                      console.error('Delete schedule error:', error);
                      alert('削除に失敗しました');
                      return;
                    }
                    
                    await loadSchedules(displayMember.id);
                    alert('スケジュールを削除しました');
                  } catch (error) {
                    console.error('Delete schedule error:', error);
                    alert('削除に失敗しました');
                  }
                }}
                style={{
                  padding: '0.5rem',
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  borderRadius: '8px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                title="削除"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        ))
      ) : (
        <div style={{textAlign: 'center', padding: '3rem', color: '#999'}}>
          <Calendar size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
          <p>今日のスケジュールはありません</p>
        </div>
      )}
    </div>
  </div>
)}

  {activeTab === 'activity' && (
  <div className="activity-container">
    <h2>活動履歴</h2>
    <div className="activity-list">
      {displayMember.locationHistory && displayMember.locationHistory.length > 0 ? (
        displayMember.locationHistory.slice(0, 20).map((activity, index) => (
          <div key={index} className="activity-item">
            <div className="activity-icon">
              <MapPin size={20} />
            </div>
            <div className="activity-details">
              <p className="activity-location">{activity.address || '位置情報'}</p>
              <small className="activity-time">
                {new Date(activity.timestamp).toLocaleString('ja-JP', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </small>
            </div>
          </div>
        ))
      ) : (
        <div style={{textAlign: 'center', padding: '3rem', color: '#999'}}>
          <Activity size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
          <p>活動履歴はありません</p>
          <p style={{fontSize: '0.85rem', marginTop: '0.5rem'}}>
            GPS追跡を開始すると、位置情報の履歴が記録されます
          </p>
        </div>
      )}
    </div>
  </div>
)}

                  {activeTab === 'alerts' && (
                    <div className="alerts-container">
                      <h2>アラート通知</h2>
                      {alerts.length === 0 ? (
                        <div className="no-alerts">
                          <Bell size={48} />
                          <p>アラートはありません</p>
                        </div>
                      ) : (
                        <div className="alerts-list">
                          {alerts.map(alert => (
                            <div key={alert.id} className={'alert-item ' + alert.type}>
                              <div className="alert-icon">
                                {alert.type === 'arrival' ? <Check size={20} /> : 
                                 alert.type === 'sos' ? <AlertTriangle size={20} /> :
                                 alert.type === 'lost' ? <Navigation size={20} /> :
                                 <Bell size={20} />}
                              </div>
                              <div className="alert-content">
                                <p>{alert.message}</p>
                                <small>{alert.timestamp.toLocaleString('ja-JP')}</small>
                              </div>
                              <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                                {!alert.read && (
                                  <button 
                                    className="mark-read-btn"
                                    onClick={async () => {
                                      await supabase.from('alerts').update({ read: true }).eq('id', alert.id);
                                      setAlerts(prev => prev.map(a => a.id === alert.id ? {...a, read: true} : a));
                                    }}
                                  >
                                    既読
                                  </button>
                                )}
                                <button
                                  onClick={async () => {
                                    if (!confirm('このアラートを削除しますか？')) return;
                                    
                                    try {
                                      const { error } = await supabase
                                        .from('alerts')
                                        .delete()
                                        .eq('id', alert.id);
                                      
                                      if (error) {
                                        console.error('Delete alert error:', error);
                                        alert('削除に失敗しました');
                                        return;
                                      }
                                      
                                      setAlerts(prev => prev.filter(a => a.id !== alert.id));
                                    } catch (error) {
                                      console.error('Delete alert error:', error);
                                      alert('削除に失敗しました');
                                    }
                                  }}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    background: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: '600',
                                    fontSize: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    transition: 'all 0.2s'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#dc2626';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#ef4444';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                  }}
                                >
                                  削除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="no-selection">
                <Users size={64} />
                <h2>メンバーを選択してください</h2>
                <p>左側のリストから確認したい家族メンバーを選んでください</p>
              </div>
            )}
          </main>
        </div>

{showChat && displayMember && (
  <div className="chat-modal" onClick={(e) => {
    if (e.target.className === 'chat-modal') {
      setShowChat(false);
      setShowEmojiPicker(false);
      setShowMessageMenu(null);
    }
  }}>
    <div className="chat-container" onClick={(e) => e.stopPropagation()}>
      <div className="chat-header" style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
          <div
            style={{
              background: displayMember.avatarUrl ? 'white' : 'rgba(255,255,255,0.3)',
              borderRadius: '50%',
              width: '48px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              flexShrink: 0,
              overflow: 'hidden',
              border: displayMember.avatarUrl ? '2px solid rgba(255,255,255,0.5)' : 'none'
            }}
          >
            {displayMember.avatarUrl ? (
              <img 
                src={displayMember.avatarUrl} 
                alt={displayMember.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            ) : (
              <span style={{fontSize: '1.5rem', fontWeight: '700'}}>
                {displayMember.avatar}
              </span>
            )}
          </div>
          <div>
            <h3 style={{color: 'white', margin: 0}}>{displayMember.name}</h3>
            <p style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', margin: 0}}>
              {displayMember.status === 'safe' ? '安全' : 
               displayMember.status === 'warning' ? '道に迷ってる' : '緊急'}
            </p>
          </div>
        </div>
        <button 
          className="close-btn" 
          onClick={() => {
            setShowChat(false);
            setShowEmojiPicker(false);
            setShowMessageMenu(null);
            cancelEditMessage();
          }}
          style={{background: 'rgba(255,255,255,0.2)', color: 'white'}}
        >
          <X size={20} />
        </button>
      </div>

      <div className="chat-messages" style={{
        background: '#e5ddd5', 
        padding: '1rem',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        flex: 1
      }}>
        <style>{`
          .chat-messages::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        {messages
          .filter(m => 
            (m.from === currentUser.id && m.to === displayMember.userId) || 
            (m.from === displayMember.userId && m.to === currentUser.id)
          )
          .length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999'
            }}>
              <MessageCircle size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
              <p>まだメッセージがありません</p>
              <p style={{fontSize: '0.85rem'}}>最初のメッセージを送信しましょう</p>
            </div>
          ) : (
            messages
              .filter(m => 
                (m.from === currentUser.id && m.to === displayMember.userId) || 
                (m.from === displayMember.userId && m.to === currentUser.id)
              )
              .map(msg => {
                const isMine = msg.from === currentUser.id;
                
                return (
                  <div 
                    key={msg.id} 
                    style={{
                      display: 'flex',
                      flexDirection: isMine ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                      marginBottom: '1rem',
                      gap: '0.5rem',
                      width: '100%'
                    }}
                  >
                    {!isMine && (
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: displayMember.avatarUrl ? 'white' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: '700',
                        fontSize: '0.9rem',
                        flexShrink: 0,
                        overflow: 'hidden',
                        border: displayMember.avatarUrl ? '2px solid #ddd' : 'none'
                      }}>
                        {displayMember.avatarUrl ? (
                          <img 
                            src={displayMember.avatarUrl} 
                            alt={displayMember.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          displayMember.avatar
                        )}
                      </div>
                    )}
                    
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      maxWidth: '65%',
                      width: 'auto',
                      position: 'relative'
                    }}>
                      <div 
                        onContextMenu={(e) => {
                          if (isMine) {
                            e.preventDefault();
                            setShowMessageMenu(showMessageMenu === msg.id ? null : msg.id);
                          }
                        }}
                        onClick={() => {
                          if (isMine && showMessageMenu !== msg.id) {
                            setShowMessageMenu(msg.id);
                          }
                        }}
                        style={{
                          padding: '0.625rem 0.875rem',
                          borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          background: isMine ? '#dcf8c6' : 'white',
                          color: '#000',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          position: 'relative',
                          wordBreak: 'break-word',
                          width: 'fit-content',
                          minWidth: '60px',
                          cursor: isMine ? 'pointer' : 'default'
                        }}
                      >
                        <p style={{margin: 0, lineHeight: '1.4', fontSize: '0.95rem'}}>{msg.text}</p>
                        
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '0.25rem',
                          marginTop: '0.25rem'
                        }}>
                          <small style={{fontSize: '0.65rem', color: '#889'}}>
                            {msg.timestamp.toLocaleTimeString('ja-JP', { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                            {msg.edited && ' • 編集済み'}
                          </small>
                          {isMine && (
                            <span style={{
                              fontSize: '0.65rem', 
                              color: msg.read ? '#4fc3f7' : '#999', 
                              fontWeight: '600'
                            }}>
                              {msg.read ? '既読' : '未読'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* メッセージメニュー */}
                      {isMine && showMessageMenu === msg.id && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: '0.25rem',
                          background: 'white',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          overflow: 'hidden',
                          zIndex: 1000,
                          minWidth: '120px'
                        }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditMessage(msg);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.75rem 1rem',
                              background: 'none',
                              border: 'none',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: '#333'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                          >
                            <i className="fas fa-edit" style={{width: '16px'}}></i>
                            編集
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMessage(msg.id);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.75rem 1rem',
                              background: 'none',
                              border: 'none',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: '#ef4444'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                          >
                            <i className="fas fa-trash" style={{width: '16px'}}></i>
                            削除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
          )}
      </div>

      <div className="chat-input" style={{
        background: '#f0f0f0', 
        padding: '0.75rem', 
        display: 'flex', 
        gap: '0.5rem', 
        alignItems: 'flex-end',
        position: 'relative'
      }}>
        {editingMessageId ? (
          // 編集モード
          <>
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{
                fontSize: '0.8rem',
                color: '#667eea',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <i className="fas fa-edit"></i>
                メッセージを編集中
              </div>
              <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowEmojiPicker(!showEmojiPicker);
                  }}
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  😊
                </button>
                <input 
                  type="text" 
                  value={editingMessageText} 
                  onChange={(e) => setEditingMessageText(e.target.value)} 
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault(); 
                      saveEditMessage();
                    } else if (e.key === 'Escape') {
                      cancelEditMessage();
                    }
                  }}
                  placeholder="メッセージを編集..." 
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: '2px solid #667eea',
                    borderRadius: '20px',
                    fontSize: '0.95rem',
                    outline: 'none'
                  }}
                />
                <button 
                  onClick={(e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    saveEditMessage();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  type="button"
                  style={{
                    background: '#10b981',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    flexShrink: 0
                  }}
                >
                  <Check size={20} />
                </button>
                <button 
                  onClick={(e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    cancelEditMessage();
                  }}
                  type="button"
                  style={{
                    background: '#ef4444',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    flexShrink: 0
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          // 通常モード
          <>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowEmojiPicker(!showEmojiPicker);
              }}
              type="button"
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                padding: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              😊
            </button>
            
            {showEmojiPicker && (
              <div style={{
                position: 'absolute',
                bottom: '70px',
                left: '10px',
                background: 'white',
                border: '1px solid #e9ecef',
                borderRadius: '12px',
                padding: '0.75rem',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: '0.5rem',
                maxWidth: '300px',
                zIndex: 1000
              }}>
                {emojis.map((emoji, index) => (
                  <button
                    key={index}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addEmoji(emoji);
                    }}
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '1.5rem',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      borderRadius: '4px',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            
            <input 
              type="text" 
              value={newMessage} 
              onChange={(e) => setNewMessage(e.target.value)} 
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault(); 
                  sendMessage();
                }
              }}
              placeholder="メッセージを入力..." 
              style={{
                flex: 1,
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '20px',
                fontSize: '0.95rem',
                outline: 'none'
              }}
            />
            <button 
              onClick={(e) => {
                e.preventDefault(); 
                e.stopPropagation();
                sendMessage();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              className="send-btn"
              type="button"
              style={{
                background: '#667eea',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'white',
                flexShrink: 0
              }}
            >
              <Send size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  </div>
)}

        {showScheduleModal && (
          <div className="chat-modal">
            <div className="chat-container" style={{maxWidth: '500px'}}>
              <div className="chat-header">
                <h3>スケジュールを追加</h3>
                <button 
                  className="close-btn"
                  onClick={() => setShowScheduleModal(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{padding: '1.5rem'}}>
                <div className="form-group">
                  <label>タイトル</label>
                  <input
                    type="text"
                    value={scheduleForm.title}
                    onChange={(e) => setScheduleForm({...scheduleForm, title: e.target.value})}
                    placeholder="例: 学校へ登校"
                  />
                </div>

                <div className="form-group">
                  <label>時間</label>
                  <input
                    type="time"
                    value={scheduleForm.time}
                    onChange={(e) => setScheduleForm({...scheduleForm, time: e.target.value})}
                  />
                </div>

                <div className="form-group">
                  <label>種別</label>
                  <select
                    value={scheduleForm.type}
                    onChange={(e) => setScheduleForm({...scheduleForm, type: e.target.value})}
                  >
                    <option value="departure">出発</option>
                    <option value="arrival">到着</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>場所</label>
                  <input
                    type="text"
                    value={scheduleForm.location}
                    onChange={(e) => setScheduleForm({...scheduleForm, location: e.target.value})}
                    placeholder="例: 東京第一小学校"
                  />
                </div>

                <button 
                  onClick={async () => {
                    const displayMember = members.find(m => m.id === selectedMemberId) || members[0];
                    if (!scheduleForm.title || !scheduleForm.time || !displayMember) {
                      alert('タイトルと時間を入力してください');
                      return;
                    }

                    try {
                      console.log('Adding schedule:', {
                        member_id: displayMember.id,
                        title: scheduleForm.title,
                        time: scheduleForm.time
                      });

                      const { data, error } = await supabase
                        .from('schedules')
                        .insert([{
                          member_id: displayMember.id,
                          title: scheduleForm.title,
                          time: scheduleForm.time,
                          type: scheduleForm.type,
                          location: scheduleForm.location,
                          date: new Date().toISOString().split('T')[0],
                          completed: false
                        }])
                        .select();

                      if (error) {
                        console.error('Schedule insert error:', error);
                        alert('スケジュールの追加に失敗しました: ' + error.message);
                        return;
                      }

                      console.log('Schedule added successfully:', data);
                      setScheduleForm({ title: '', time: '', type: 'departure', location: '' });
                      setShowScheduleModal(false);
                      await loadSchedules(displayMember.id);
                      alert('スケジュールを追加しました');
                    } catch (error) {
                      console.error('Add schedule error:', error);
                      alert('スケジュールの追加に失敗しました: ' + error.message);
                    }
                  }}
                  className="login-btn primary"
                  style={{width: '100%', marginTop: '1rem'}}
                >
                  追加
                </button>
              </div>
            </div>
          </div>
        )}

        {showMemberManagement && (
          <div className="chat-modal">
            <div className="chat-container" style={{maxWidth: '600px'}}>
              <div className="chat-header">
                <h3>メンバー管理</h3>
                <button 
                  className="close-btn"
                  onClick={() => setShowMemberManagement(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{padding: '1.5rem'}}>
                <h4 style={{marginBottom: '1rem', color: '#333'}}>登録されている子供</h4>
                
                {myChildren.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '2rem', color: '#999'}}>
                    <Users size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
                    <p>まだ子供が登録されていません</p>
                  </div>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
                    {myChildren.map(member => (
                      <div 
                        key={member.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '1rem',
                          background: '#f8f9fa',
                          borderRadius: '12px',
                          border: '1px solid #e9ecef'
                        }}
                      >
                        <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                          <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontWeight: '600',
                            fontSize: '1.2rem'
                          }}>
                            {member.avatar}
                          </div>
                          <div>
                            <h4 style={{margin: 0, color: '#333'}}>{member.name}</h4>
                            <p style={{margin: 0, fontSize: '0.85rem', color: '#666'}}>
                              バッテリー: {member.battery}% | 
                              状態: {member.status === 'safe' ? '安全' : '道に迷ってる'}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            if (!confirm(`${member.name}を削除しますか？この操作は取り消せません。`)) {
                              return;
                            }

                            try {
                              const { error: deleteError } = await supabase
                                .from('parent_children')
                                .delete()
                                .eq('parent_id', currentUser.id)
                                .eq('child_id', member.userId);

                              if (deleteError) {
                                alert('削除に失敗しました: ' + deleteError.message);
                                return;
                              }

                              await loadMembersData(currentUser);
                              alert(`${member.name}を削除しました`);
                              
                              if (selectedMemberId === member.id) {
                                setSelectedMemberId(null);
                              }
                            } catch (error) {
                              console.error('Delete member error:', error);
                              alert('削除中にエラーが発生しました');
                            }
                          }}
                          style={{
                            padding: '0.5rem 1rem',
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}
                        >
                          <X size={16} />
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    setShowMemberManagement(false);
                    setCurrentView('add-child');
                  }}
                  className="login-btn primary"
                  style={{width: '100%', marginTop: '1.5rem'}}
                >
                  <Plus size={18} />
                  新しい子供を追加
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

// 子供ダッシュボード
const ChildDashboard = () => {
  const myProfile = members.find(m => m.userId === currentUser?.id);
  const [showEmergency, setShowEmergency] = useState(false);
  const [showIdCard, setShowIdCard] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [myParents, setMyParents] = useState([]);
  const [showParentsList, setShowParentsList] = useState(false);
  const [showParentChat, setShowParentChat] = useState(false);
  const [selectedParent, setSelectedParent] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [showMessageMenu, setShowMessageMenu] = useState(null);

  // 絵文字リスト
  const emojis = ['😀', '😂', '🥰', '😍', '🤔', '😅', '😊', '👍', '❤️', '🎉', '🔥', '✨', '💯', '👏', '🙏', '😭', '😱', '🤗', '😎', '🥳', '😴', '🤪', '💪', '👌', '✌️', '🙌', '👋', '💕', '💖', '🌟'];

 const addEmoji = (emoji) => {
    if (editingMessageId) {
      setEditingMessageText(prev => prev + emoji);
    } else {
      setNewMessage(prev => prev + emoji);
    }
  };

  // メッセージ削除
  const deleteMessage = async (messageId) => {
    if (!confirm('このメッセージを削除しますか？')) return;

    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);

      if (error) {
        console.error('Delete message error:', error);
        alert('メッセージの削除に失敗しました');
        return;
      }

      setMessages(prev => prev.filter(m => m.id !== messageId));
      setShowMessageMenu(null);
    } catch (error) {
      console.error('Delete message error:', error);
      alert('メッセージの削除に失敗しました');
    }
  };

  // メッセージ編集開始
  const startEditMessage = (message) => {
    setEditingMessageId(message.id);
    setEditingMessageText(message.text);
    setShowMessageMenu(null);
  };

  // メッセージ編集キャンセル
  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
  };

  // メッセージ編集保存
  const saveEditMessage = async () => {
    if (!editingMessageText.trim() || !editingMessageId) return;

    try {
      const { error } = await supabase
        .from('messages')
        .update({ 
          text: editingMessageText,
          edited: true,
          edited_at: new Date().toISOString()
        })
        .eq('id', editingMessageId);

      if (error) {
        console.error('Edit message error:', error);
        alert('メッセージの編集に失敗しました');
        return;
      }

      setMessages(prev => prev.map(m => 
        m.id === editingMessageId ? {
          ...m,
          text: editingMessageText,
          edited: true,
          editedAt: new Date()
        } : m
      ));

      setEditingMessageId(null);
      setEditingMessageText('');
    } catch (error) {
      console.error('Edit message error:', error);
      alert('メッセージの編集に失敗しました');
    }
  };

  // 未読メッセージ数を計算
  const unreadMessages = useMemo(() => {
    return messages.filter(m => m.to === currentUser?.id && !m.read).length;
  }, [messages, currentUser?.id]);

  // 画像アップロード機能
  const uploadAvatar = async (event) => {
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('画像を選択してください');
      }

      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}-${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      // 古い画像を削除
      if (currentUser.avatar_url) {
        const oldPath = currentUser.avatar_url.split('/').pop();
        await supabase.storage.from('avatars').remove([oldPath]);
      }

      // 新しい画像をアップロード
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // 公開URLを取得
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);

      // プロフィールを更新
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: data.publicUrl })
        .eq('id', currentUser.id);

      if (updateError) {
        throw updateError;
      }

      setCurrentUser({ ...currentUser, avatar_url: data.publicUrl });
      alert('プロフィール画像を更新しました！');
    } catch (error) {
      console.error('Upload error:', error);
      alert('画像のアップロードに失敗しました: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  // 保護者情報を読み込む
useEffect(() => {
  const loadMyParents = async () => {
    if (!currentUser || currentUser.role !== 'child') return;

    try {
      console.log('Loading parents for child:', currentUser.id);
      
      const { data: relationships, error: relError } = await supabase
        .from('parent_children')
        .select('parent_id')
        .eq('child_id', currentUser.id);
      
      if (relError) {
        console.error('Relationship error:', relError);
        return;
      }
      
      console.log('Found relationships:', relationships);
      
      if (relationships && relationships.length > 0) {
        const parentIds = relationships.map(r => r.parent_id);
        console.log('Parent IDs:', parentIds);
        
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, email, phone, avatar_url')  // ⭐ avatar_urlを追加
          .in('id', parentIds);
        
        if (profileError) {
          console.error('Profile error:', profileError);
          return;
        }
        
        console.log('Parent profiles:', profiles);
        
        if (profiles) {
          const parentsList = profiles.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email,
            phone: p.phone,
            avatar: 'P',
            avatarUrl: p.avatar_url
          }));
          console.log('Setting parents:', parentsList);
          setMyParents(parentsList);
        }
      } else {
        console.log('No parent relationships found');
        setMyParents([]);
      }
    } catch (error) {
      console.error('Load parents error:', error);
    }
  };

    loadMyParents();
    
    if (currentUser?.id) {
      const channel = supabase
        .channel(`child-parents-${currentUser.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'parent_children',
            filter: `child_id=eq.${currentUser.id}`
          },
          (payload) => {
            console.log('Parent relationship changed:', payload);
            loadMyParents();
          }
        )
        .subscribe((status) => {
          console.log('Parent subscription status:', status);
        });

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [currentUser?.id]);

  // メッセージをリアルタイムで受信
  useEffect(() => {
    if (!currentUser?.id) return;

    const channel = supabase
      .channel('child-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `to_user_id=eq.${currentUser.id}`
        },
        async (payload) => {
          console.log('New message received:', payload.new);
          
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', payload.new.from_user_id)
            .single();
          
          const senderName = senderProfile?.name || '不明';
          
          const newMsg = {
            id: payload.new.id,
            from: payload.new.from_user_id,
            to: payload.new.to_user_id,
            text: payload.new.text,
            timestamp: new Date(payload.new.created_at),
            read: payload.new.read
          };
          setMessages(prev => [...prev, newMsg]);
          
          if (Notification.permission === 'granted') {
            const notification = new Notification('Family Safe - 新着メッセージ', {
              body: `${senderName}: ${payload.new.text}`,
              icon: '/favicon.ico',
              tag: 'message-' + payload.new.id,
              requireInteraction: false
            });
            
            notification.onclick = () => {
              window.focus();
              const sender = myParents.find(p => p.id === payload.new.from_user_id);
              if (sender) {
                setSelectedParent(sender);
                setShowParentChat(true);
              }
              notification.close();
            };
            
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZQQ0PV7Dn77NgGQg+ltryxmsmBSp+zPLaizsIGGS56+OgTQ0NVKzn76xlHAY3k9jyy3YpBSV7yfDdlUELEly56+mjVhUJRp7f8sFuJAUuhNHzzX4yBh1svO7mnEIND1Wt5++uZBsIO5PY8sd0KgUme8rx3JA+CRZiuOndnUoODlKp5O+zYhsIOJPX8shyKwUpfcrx2486CBdjuOjdn0wODlKp5O+zYRsIOJPX8shyKwUpfcrx2486CBdjuOjdn0wODlKp5O+zYRsIOJPX8shyKwUpfcrx2486CBdjuOjdn0wO');
              audio.play().catch(e => console.log('Audio play failed:', e));
            } catch (e) {
              console.log('Audio not supported:', e);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('Message subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, myParents]);

  const sendSOS = async () => {
    if (!myProfile) return;
    
    try {
      const { error: statusError } = await supabase
        .from('members')
        .update({ status: 'danger' })
        .eq('id', myProfile.id);
      
      if (statusError) {
        console.error('Status update error:', statusError);
      }
      
      await supabase.from('alerts').insert([{
        member_id: myProfile.id, 
        type: 'sos', 
        message: myProfile.name + 'から緊急通報！'
      }]);
      
      setMembers(prev => prev.map(m => 
        m.id === myProfile.id ? { ...m, status: 'danger' } : m
      ));
      
      alert('緊急通報を送信しました！');
      setShowEmergency(false);
      if (Notification.permission === 'granted') {
        new Notification('Family Safe - 緊急通報', {
          body: '緊急通報を保護者に送信しました', 
          requireInteraction: true
        });
      }
    } catch (error) {
      console.error('SOS error:', error);
    }
  };

  const sendLostAlert = async () => {
    if (!myProfile) {
      alert('プロフィール情報が読み込まれていません');
      return;
    }

    try {
      console.log('Sending lost alert for member:', myProfile.id);
      
      const { error: statusError } = await supabase
        .from('members')
        .update({ status: 'warning' })
        .eq('id', myProfile.id);
      
      if (statusError) {
        console.error('Status update error:', statusError);
      }
      
      const { data, error } = await supabase
        .from('alerts')
        .insert([{
          member_id: myProfile.id, 
          type: 'lost', 
          message: `${myProfile.name}が道に迷っています（位置: ${myProfile.location.address}）`,
          read: false
        }])
        .select();
      
      if (error) {
        console.error('Lost alert error:', error);
        alert('アラートの送信に失敗しました: ' + error.message);
        return;
      }
      
      console.log('Lost alert sent successfully:', data);
      
      setMembers(prev => prev.map(m => 
        m.id === myProfile.id ? { ...m, status: 'warning' } : m
      ));
      
      alert('迷子アラートを送信し、GPS追跡を開始しました！');
      
      if (!gpsEnabled) {
        await startChildGPSTracking();
      }
      
      if (Notification.permission === 'granted') {
        new Notification('Family Safe - 迷子アラート', {
          body: '保護者に通知を送信し、GPS追跡を開始しました', 
          requireInteraction: true
        });
      }
    } catch (error) {
      console.error('Lost alert error:', error);
      alert('アラートの送信に失敗しました');
    }
  };

  const copyUserId = () => {
    navigator.clipboard.writeText(currentUser.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendParentMessage = async () => {
  if (!newMessage.trim() || !selectedParent) return;
  
  const messageText = newMessage;
  const tempId = 'temp-' + Date.now();
  const timestamp = new Date();
  
  const optimisticMessage = {
    id: tempId,
    from: currentUser.id,
    to: selectedParent.id,
    text: messageText,
    timestamp: timestamp,
    read: false
  };
  
  setMessages(prev => [...prev, optimisticMessage]);
  setNewMessage('');
  setShowEmojiPicker(false);
  
  try {
    console.log('Sending message to:', selectedParent.id);
    
    const { data, error } = await supabase
      .from('messages')
      .insert([{
        from_user_id: currentUser.id,
        to_user_id: selectedParent.id,
        text: messageText,
        read: false
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Send message error:', error);
      alert('メッセージの送信に失敗しました');
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(messageText);
      return;
    }
    
    console.log('Message sent successfully');
    
    if (data) {
      setMessages(prev => prev.map(m => 
        m.id === tempId ? {
          id: data.id,
          from: data.from_user_id,
          to: data.to_user_id,
          text: data.text,
          timestamp: new Date(data.created_at),
          read: data.read
        } : m
      ));
    }
  } catch (error) {
    console.error('Send message error:', error);
    setMessages(prev => prev.filter(m => m.id !== tempId));
    setNewMessage(messageText);
  }
};

  if (!myProfile) {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.2rem', color: '#666'}}>
        <div style={{textAlign: 'center'}}>
          <div style={{width: '50px', height: '50px', border: '4px solid #f3f3f3', borderTop: '4px solid #667eea', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem'}}></div>
          <p>プロフィールを読み込んでいます...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="child-dashboard">
      <header className="child-header">
  <h1>
    <i className="fas fa-child" style={{marginRight: '0.5rem'}}></i>
    {myProfile.name}
  </h1>
  <div className="child-header-buttons">
    <button 
      onClick={() => setCurrentView('group-list')} 
      className="group-btn"
    >
      <Users size={18} />
      <span>グループ</span>
    </button>
    
    <button 
      onClick={() => setShowParentsList(true)} 
      className="parent-btn"
    >
      <MessageCircle size={18} />
      <span>保護者{myParents.length > 0 ? ` (${myParents.length})` : ''}</span>
      {unreadMessages > 0 && (
        <span style={{
          position: 'absolute',
          top: '-5px',
          right: '-5px',
          background: '#ef4444',
          color: 'white',
          fontSize: '0.7rem',
          fontWeight: '600',
          padding: '2px 6px',
          borderRadius: '10px',
          minWidth: '18px',
          textAlign: 'center'
        }}>
          {unreadMessages}
        </span>
      )}
    </button>
    
    <button 
      onClick={() => setShowIdCard(true)} 
      className="id-btn"
    >
      <i className="fas fa-shield-alt"></i>
      <span>マイID</span>
    </button>
    
    <button 
      onClick={() => setShowProfile(true)} 
      className="profile-btn"
    >
      <User size={18} />
      <span>プロフィール</span>
    </button>
    
    <button 
      onClick={async () => {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        await supabase.auth.signOut();
        setCurrentUser(null);
        setCurrentView('login');
      }} 
      className="logout-btn-simple"
    >
      <LogOut size={18} />
      <span>ログアウト</span>
    </button>
  </div>
</header>

      <div className="child-content">
        <div className="status-card">
          <div className={'status-indicator ' + myProfile.status}>
            {myProfile.status === 'safe' && <><i className="fas fa-check-circle"></i> 安全です</>}
            {myProfile.status === 'warning' && <><i className="fas fa-exclamation-triangle"></i> 道に迷っています</>}
            {myProfile.status === 'danger' && <><i className="fas fa-exclamation-circle"></i> 緊急です</>}
          </div>
        </div>

        <div className="destination-card">
          <h2><i className="fas fa-map-marker-alt" style={{marginRight: '0.5rem'}}></i>現在の場所</h2>
          <div className="current-location">
            <MapPin size={24} />
            <p>{myProfile.location.address}</p>
          </div>
        </div>

        <div className="child-info-grid">
          <div className="info-box">
            <Battery size={24} className="info-icon" />
            <div>
              <h3>バッテリー</h3>
              <p className="info-value">{myProfile.battery}%</p>
            </div>
          </div>
          <div className="info-box">
            <Clock size={24} className="info-icon" />
            <div>
              <h3>最終更新</h3>
              <p className="info-value">{myProfile.lastUpdate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}</p>
            </div>
          </div>
        </div>

        <div className="gps-control">
          <button onClick={() => gpsEnabled ? null : startChildGPSTracking()} className={'gps-toggle ' + (gpsEnabled ? 'active' : '')} disabled={gpsEnabled}>
            <Navigation size={24} />
            <span>{gpsEnabled ? 'GPS追跡中（保護者が制御中）' : 'GPS開始'}</span>
          </button>
          {gpsEnabled && <p style={{fontSize: '0.85rem', color: '#666', textAlign: 'center', marginTop: '0.5rem'}}><i className="fas fa-info-circle"></i> GPS追跡は保護者のみが停止できます</p>}
          <button onClick={() => updateLocationOnce(myProfile.id)} className="gps-toggle refresh" style={{marginTop: '0.5rem'}}>
            <Clock size={24} />
            <span>現在地を更新</span>
          </button>
        </div>

        <div className="emergency-section">
          <h2>困ったときは</h2>
          <div className="emergency-buttons">
            <button className="emergency-btn lost" onClick={sendLostAlert}>
              <Navigation size={24} />
              <span>道に迷った</span>
            </button>
            <button className="emergency-btn sos" onClick={() => setShowEmergency(true)}>
              <AlertTriangle size={24} />
              <span>緊急通報</span>
            </button>
          </div>
        </div>
      </div>

      {showEmergency && (
        <div className="emergency-modal">
          <div className="emergency-dialog">
            <AlertTriangle size={64} className="emergency-icon" />
            <h2>緊急通報</h2>
            <p>本当に緊急通報を送信しますか？</p>
            <p className="emergency-warning">保護者に緊急通知が送られます</p>
            <div className="emergency-actions">
              <button onClick={sendSOS} className="confirm-sos">はい、送信する</button>
              <button onClick={() => setShowEmergency(false)} className="cancel-sos">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {showIdCard && (
        <div className="emergency-modal">
          <div className="emergency-dialog" style={{maxWidth: '400px'}}>
            <div style={{textAlign: 'center', marginBottom: '1.5rem'}}>
              <i className="fas fa-shield-alt" style={{fontSize: '4rem', color: '#667eea', marginBottom: '1rem'}}></i>
              <h2 style={{marginBottom: '0.5rem'}}>マイユーザーID</h2>
              <p style={{fontSize: '0.9rem', color: '#666'}}>保護者にこのIDを共有してください</p>
            </div>
            <div style={{background: '#f5f5f5', padding: '1rem', borderRadius: '12px', marginBottom: '1.5rem', wordBreak: 'break-all', fontSize: '0.85rem', fontFamily: 'monospace', textAlign: 'center', border: '2px dashed #667eea'}}>
              {currentUser.id}
            </div>
            <button onClick={copyUserId} style={{width: '100%', padding: '1rem', background: copied ? '#4CAF50' : '#667eea', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}}>
              {copied ? <><i className="fas fa-check-circle"></i>コピーしました！</> : <><i className="far fa-clipboard"></i> IDをコピー</>}
            </button>
            <button onClick={() => setShowIdCard(false)} style={{width: '100%', padding: '0.875rem', background: 'transparent', color: '#666', border: '2px solid #ddd', borderRadius: '12px', cursor: 'pointer', fontWeight: '600'}}>閉じる</button>
          </div>
        </div>
      )}

      {showProfile && (
        <div className="emergency-modal">
          <div className="emergency-dialog" style={{maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '2px solid #e9ecef'}}>
              <h2 style={{margin: 0, fontSize: '1.5rem', color: '#333'}}>
                <User size={24} style={{verticalAlign: 'middle', marginRight: '0.5rem'}} />
                マイプロフィール
              </h2>
              <button onClick={() => setShowProfile(false)} style={{background: '#f8f9fa', border: 'none', cursor: 'pointer', padding: '0.5rem', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'}} onMouseEnter={(e) => e.currentTarget.style.background = '#e9ecef'} onMouseLeave={(e) => e.currentTarget.style.background = '#f8f9fa'}>
                <X size={24} style={{color: '#666'}} />
              </button>
            </div>
            
            <div style={{textAlign: 'center', padding: '2rem 0', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '16px', marginBottom: '2rem', position: 'relative'}}>
              <div style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: currentUser.avatar_url ? 'white' : 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#667eea',
                fontSize: '4rem',
                fontWeight: '700',
                margin: '0 auto 1rem',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                overflow: 'hidden',
                position: 'relative'
              }}>
                {currentUser.avatar_url ? (
                  <img 
                    src={currentUser.avatar_url} 
                    alt={myProfile.name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                ) : (
                  myProfile.avatar
                )}
                
                <label style={{
                  position: 'absolute',
                  bottom: '0',
                  right: '0',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: '#667eea',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  border: '3px solid white'
                }}>
                  <i className="fas fa-camera" style={{color: 'white', fontSize: '1rem'}}></i>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={uploadAvatar}
                    disabled={uploading}
                    style={{display: 'none'}}
                  />
                </label>
              </div>
              <h3 style={{margin: 0, color: 'white', fontSize: '1.5rem', fontWeight: '600'}}>{myProfile.name}</h3>
              <p style={{margin: '0.5rem 0 0 0', color: 'rgba(255,255,255,0.9)', fontSize: '1rem'}}>子供アカウント</p>
              {uploading && (
                <p style={{margin: '0.5rem 0 0 0', color: 'white', fontSize: '0.85rem'}}>
                  <i className="fas fa-spinner fa-spin"></i> アップロード中...
                </p>
              )}
            </div>
            
            <div style={{marginBottom: '1.5rem'}}>
              <h4 style={{fontSize: '0.9rem', color: '#666', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600'}}>ユーザー情報</h4>
              
              <div style={{background: '#f8f9fa', padding: '1rem', borderRadius: '12px', marginBottom: '0.75rem'}}>
                <label style={{display: 'block', fontSize: '0.8rem', color: '#999', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>ユーザーID</label>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                  <div style={{flex: 1, background: 'white', padding: '0.75rem', borderRadius: '8px', fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all', color: '#333', border: '1px solid #e9ecef'}}>
                    {currentUser.id}
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(currentUser.id); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{padding: '0.75rem 1rem', background: copied ? '#10b981' : '#667eea', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', whiteSpace: 'nowrap', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    {copied ? <><i className="fas fa-check"></i>コピー済</> : <><i className="far fa-clipboard"></i>コピー</>}
                  </button>
                </div>
              </div>
              
              <div style={{background: '#f8f9fa', padding: '1rem', borderRadius: '12px', marginBottom: '0.75rem'}}>
                <label style={{display: 'block', fontSize: '0.8rem', color: '#999', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>メールアドレス</label>
                <div style={{background: 'white', padding: '0.75rem', borderRadius: '8px', fontSize: '0.9rem', color: '#333', border: '1px solid #e9ecef', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                  <Mail size={16} style={{color: '#667eea'}} />
                  {currentUser.email}
                </div>
              </div>
              
              <div style={{background: '#f8f9fa', padding: '1rem', borderRadius: '12px', marginBottom: '0.75rem'}}>
                <label style={{display: 'block', fontSize: '0.8rem', color: '#999', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>現在の状態</label>
                <div style={{background: 'white', padding: '0.75rem', borderRadius: '8px', fontSize: '0.9rem', border: '1px solid #e9ecef', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                  <span className={'status-dot ' + myProfile.status} style={{width: '12px', height: '12px', borderRadius: '50%', display: 'inline-block'}}></span>
                  <span style={{color: '#333', fontWeight: '500'}}>
                    {myProfile.status === 'safe' ? '安全' : myProfile.status === 'warning' ? '道に迷ってる' : '危険'}
                  </span>
                </div>
              </div>
            </div>
            
            <div style={{marginBottom: '1.5rem'}}>
              <h4 style={{fontSize: '0.9rem', color: '#666', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600'}}>ステータス</h4>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem'}}>
                <div style={{background: '#f8f9fa', padding: '1rem', borderRadius: '12px'}}>
                  <label style={{display: 'block', fontSize: '0.8rem', color: '#999', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>バッテリー</label>
                  <div style={{background: 'white', padding: '0.75rem', borderRadius: '8px', fontSize: '1.1rem', fontWeight: '600', color: '#333', border: '1px solid #e9ecef', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <Battery size={20} style={{color: myProfile.battery > 20 ? '#10b981' : '#ef4444'}} />
                    {myProfile.battery}%
                  </div>
                </div>
                <div style={{background: '#f8f9fa', padding: '1rem', borderRadius: '12px'}}>
                  <label style={{display: 'block', fontSize: '0.8rem', color: '#999', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>GPS状態</label>
                  <div style={{background: 'white', padding: '0.75rem', borderRadius: '8px', fontSize: '1.1rem', fontWeight: '600', color: '#333', border: '1px solid #e9ecef', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <Navigation size={20} style={{color: gpsEnabled ? '#10b981' : '#999'}} />
                    {gpsEnabled ? 'ON' : 'OFF'}
                  </div>
                </div>
              </div>
            </div>
            
  <div style={{marginBottom: '1.5rem'}}>
  <h4 style={{fontSize: '0.9rem', color: '#666', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600'}}>登録されている保護者 ({myParents.length}人)</h4>
  {myParents.length > 0 ? (
    <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
      {myParents.map(parent => (
        <div key={parent.id} style={{background: '#f8f9fa', padding: '1rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid #e9ecef'}}>
          <div style={{
            width: '48px', 
            height: '48px', 
            borderRadius: '50%', 
            background: parent.avatarUrl ? 'white' : 'linear-gradient(135deg, #667eea 0%, #667eea 100%)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: 'white', 
            fontWeight: '700', 
            fontSize: '1.2rem', 
            flexShrink: 0,
            overflow: 'hidden',
            border: parent.avatarUrl ? '2px solid #667eea' : 'none'
          }}>
            {parent.avatarUrl ? (
              <img 
                src={parent.avatarUrl} 
                alt={parent.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            ) : (
              parent.avatar
            )}
          </div>
          <div style={{flex: 1, minWidth: 0}}>
            <h4 style={{margin: 0, fontSize: '1rem', color: '#333', fontWeight: '600'}}>{parent.name}</h4>
            <p style={{margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{parent.email}</p>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div style={{background: '#f8f9fa', padding: '2rem', borderRadius: '12px', textAlign: 'center', border: '2px dashed #e9ecef'}}>
      <User size={48} style={{color: '#ccc', marginBottom: '1rem'}} />
      <p style={{color: '#999', fontSize: '0.9rem', margin: 0}}>まだ保護者が登録されていません</p>
    </div>
  )}
</div>
            
            <button onClick={() => setShowProfile(false)} style={{width: '100%', padding: '1rem', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'}} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.4)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)'; }}>
              <i className=""></i>
              閉じる
            </button>
          </div>
        </div>
      )}

{showParentsList && (
  <div className="emergency-modal">
    <div className="emergency-dialog" style={{maxWidth: '500px'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
        <h2 style={{margin: 0}}>登録されている保護者</h2>
        <button onClick={() => setShowParentsList(false)} style={{background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem'}}>
          <X size={24} />
        </button>
      </div>
      
      {myParents.length === 0 ? (
        <div style={{textAlign: 'center', padding: '2rem', color: '#999'}}>
          <User size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
          <p>まだ保護者が登録されていません</p>
          <p style={{fontSize: '0.85rem', marginTop: '1rem'}}>保護者にあなたのユーザーIDを共有してください</p>
          <div style={{background: '#E3F2FD', padding: '1rem', borderRadius: '12px', marginTop: '1.5rem', textAlign: 'left'}}>
            <p style={{fontSize: '0.9rem', color: '#1976D2', margin: 0, marginBottom: '0.5rem'}}>
              <i className="fas fa-info-circle"></i> 手順:
            </p>
            <ol style={{fontSize: '0.85rem', color: '#1976D2', margin: 0, paddingLeft: '1.5rem'}}>
              <li>上部の「マイID」ボタンをクリック</li>
              <li>IDをコピー</li>
              <li>保護者に共有（メール、LINE等）</li>
              <li>保護者が「子供を追加」でIDを入力</li>
            </ol>
          </div>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
          {myParents.map(parent => (
            <div key={parent.id} className="parent-list-card">
              <div style={{display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem'}}>
                <div style={{
                  width: '56px', 
                  height: '56px', 
                  borderRadius: '50%', 
                  background: parent.avatarUrl ? 'white' : 'linear-gradient(135deg, #667eea 0%, #667eea 100%)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  color: 'white', 
                  fontWeight: '700', 
                  fontSize: '1.5rem', 
                  flexShrink: 0,
                  overflow: 'hidden',
                  border: parent.avatarUrl ? '2px solid #667eea' : 'none'
                }}>
                  {parent.avatarUrl ? (
                    <img 
                      src={parent.avatarUrl} 
                      alt={parent.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    parent.avatar
                  )}
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <h4 style={{margin: 0, color: '#333', marginBottom: '0.5rem', fontSize: '1.1rem'}}>{parent.name}</h4>
                  <p style={{margin: 0, fontSize: '0.85rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    <Mail size={14} />
                    {parent.email}
                  </p>
                  {parent.phone && (
                    <p style={{margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
                      <Phone size={14} />
                      {parent.phone}
                    </p>
                  )}
                </div>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: parent.phone ? '1fr 1fr' : '1fr', gap: '0.75rem'}}>
                <button onClick={() => { setSelectedParent(parent); setShowParentChat(true); setShowParentsList(false); }} style={{padding: '0.875rem', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)'}} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)'; }}>
                  <MessageCircle size={16} />
                  チャット
                </button>
                {parent.phone && (
                  <button onClick={() => window.location.href = 'tel:' + parent.phone} style={{padding: '0.875rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'}} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)'; }}>
                    <Phone size={16} />
                    電話
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
)}

{showParentChat && selectedParent && (
  <div className="chat-modal">
    <div className="chat-container">
      <div className="chat-header" style={{
        background: 'linear-gradient(135deg, #667eea 0%, #667eea 100%)'
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
          <div
            style={{
              background: selectedParent.avatarUrl ? 'white' : 'rgba(255,255,255,0.3)',
              borderRadius: '50%',
              width: '48px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              flexShrink: 0,
              overflow: 'hidden',
              border: selectedParent.avatarUrl ? '2px solid rgba(255,255,255,0.5)' : 'none'
            }}
          >
            {selectedParent.avatarUrl ? (
              <img 
                src={selectedParent.avatarUrl} 
                alt={selectedParent.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            ) : (
              <span style={{fontSize: '1.5rem', fontWeight: '700'}}>
                {selectedParent.avatar}
              </span>
            )}
          </div>
          <div>
            <h3 style={{color: 'white', margin: 0}}>{selectedParent.name}</h3>
            <p style={{fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', margin: 0}}>
              保護者
            </p>
          </div>
        </div>
        <button 
          className="close-btn" 
          onClick={() => {
            setShowParentChat(false);
            setShowEmojiPicker(false);
            setShowMessageMenu(null);
            cancelEditMessage();
          }}
          style={{background: 'rgba(255,255,255,0.2)', color: 'white'}}
        >
          <X size={20} />
        </button>
      </div>

      <div className="chat-messages" style={{
        background: '#e5ddd5', 
        padding: '1rem',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        flex: 1
      }}>
        <style>{`
          .chat-messages::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        {messages
          .filter(m => 
            (m.from === currentUser.id && m.to === selectedParent.id) || 
            (m.from === selectedParent.id && m.to === currentUser.id)
          )
          .length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999'
            }}>
              <MessageCircle size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
              <p>まだメッセージがありません</p>
              <p style={{fontSize: '0.85rem'}}>最初のメッセージを送信しましょう</p>
            </div>
          ) : (
            messages
              .filter(m => 
                (m.from === currentUser.id && m.to === selectedParent.id) || 
                (m.from === selectedParent.id && m.to === currentUser.id)
              )
              .map(msg => {
                const isMine = msg.from === currentUser.id;
                
                return (
                  <div 
                    key={msg.id} 
                    style={{
                      display: 'flex',
                      flexDirection: isMine ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                      marginBottom: '1rem',
                      gap: '0.5rem',
                      width: '100%'
                    }}
                  >
                    {!isMine && (
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: selectedParent.avatarUrl ? 'white' : 'linear-gradient(135deg, #667eea 0%, #667eea 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: '700',
                        fontSize: '0.9rem',
                        flexShrink: 0,
                        overflow: 'hidden',
                        border: selectedParent.avatarUrl ? '2px solid #ddd' : 'none'
                      }}>
                        {selectedParent.avatarUrl ? (
                          <img 
                            src={selectedParent.avatarUrl} 
                            alt={selectedParent.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          selectedParent.avatar
                        )}
                      </div>
                    )}
                    
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      maxWidth: '65%',
                      width: 'auto',
                      position: 'relative'
                    }}>
                      <div 
                        onContextMenu={(e) => {
                          if (isMine) {
                            e.preventDefault();
                            setShowMessageMenu(showMessageMenu === msg.id ? null : msg.id);
                          }
                        }}
                        onClick={() => {
                          if (isMine && showMessageMenu !== msg.id) {
                            setShowMessageMenu(msg.id);
                          }
                        }}
                        style={{
                          padding: '0.625rem 0.875rem',
                          borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          background: isMine ? '#dcf8c6' : 'white',
                          color: '#000',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          position: 'relative',
                          wordBreak: 'break-word',
                          width: 'fit-content',
                          minWidth: '60px',
                          cursor: isMine ? 'pointer' : 'default'
                        }}
                      >
                        <p style={{margin: 0, lineHeight: '1.4', fontSize: '0.95rem'}}>{msg.text}</p>
                        
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '0.25rem',
                          marginTop: '0.25rem'
                        }}>
                          <small style={{fontSize: '0.65rem', color: '#889'}}>
                            {msg.timestamp.toLocaleTimeString('ja-JP', { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                            {msg.edited && ' • 編集済み'}
                          </small>
                          {isMine && (
                            <span style={{
                              fontSize: '0.65rem', 
                              color: msg.read ? '#4fc3f7' : '#999', 
                              fontWeight: '600'
                            }}>
                              {msg.read ? '既読' : '未読'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* メッセージメニュー */}
                      {isMine && showMessageMenu === msg.id && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: '0.25rem',
                          background: 'white',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          overflow: 'hidden',
                          zIndex: 1000,
                          minWidth: '120px'
                        }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditMessage(msg);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.75rem 1rem',
                              background: 'none',
                              border: 'none',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: '#333'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                          >
                            <i className="fas fa-edit" style={{width: '16px'}}></i>
                            編集
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMessage(msg.id);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.75rem 1rem',
                              background: 'none',
                              border: 'none',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: '#ef4444'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                          >
                            <i className="fas fa-trash" style={{width: '16px'}}></i>
                            削除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
          )}
      </div>

      <div className="chat-input" style={{
        background: '#f0f0f0', 
        padding: '0.75rem', 
        display: 'flex', 
        gap: '0.5rem', 
        alignItems: 'flex-end',
        position: 'relative'
      }}>
        {editingMessageId ? (
          // 編集モード
          <>
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{
                fontSize: '0.8rem',
                color: '#667eea',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <i className="fas fa-edit"></i>
                メッセージを編集中
              </div>
              <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowEmojiPicker(!showEmojiPicker);
                  }}
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  😊
                </button>
                <input 
                  type="text" 
                  value={editingMessageText} 
                  onChange={(e) => setEditingMessageText(e.target.value)} 
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault(); 
                      saveEditMessage();
                    } else if (e.key === 'Escape') {
                      cancelEditMessage();
                    }
                  }}
                  placeholder="メッセージを編集..." 
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: '2px solid #667eea',
                    borderRadius: '20px',
                    fontSize: '0.95rem',
                    outline: 'none'
                  }}
                />
                <button 
                  onClick={(e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    saveEditMessage();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  type="button"
                  style={{
                    background: '#10b981',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    flexShrink: 0
                  }}
                >
                  <Check size={20} />
                </button>
                <button 
                  onClick={(e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    cancelEditMessage();
                  }}
                  type="button"
                  style={{
                    background: '#ef4444',
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    flexShrink: 0
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          // 通常モード
          <>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowEmojiPicker(!showEmojiPicker);
              }}
              type="button"
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                padding: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              😊
            </button>
            
            {showEmojiPicker && (
              <div style={{
                position: 'absolute',
                bottom: '70px',
                left: '10px',
                background: 'white',
                border: '1px solid #e9ecef',
                borderRadius: '12px',
                padding: '0.75rem',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: '0.5rem',
                maxWidth: '300px',
                zIndex: 1000
              }}>
                {emojis.map((emoji, index) => (
                  <button
                    key={index}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addEmoji(emoji);
                    }}
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '1.5rem',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      borderRadius: '4px',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            
            <input 
              type="text" 
              value={newMessage} 
              onChange={(e) => setNewMessage(e.target.value)} 
              onKeyPress={(e) => { 
                if (e.key === 'Enter' && !e.shiftKey) { 
                  e.preventDefault(); 
                  sendParentMessage(); 
                } 
              }} 
              placeholder="メッセージを入力..." 
              style={{
                flex: 1,
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '20px',
                fontSize: '0.95rem',
                outline: 'none'
              }}
            />
            <button 
              onClick={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                sendParentMessage(); 
              }}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              className="send-btn" 
              type="button"
              style={{
                background: '#667eea',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'white',
                flexShrink: 0
              }}
            >
              <Send size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  );
};

// ルーティング
if (currentView === 'login') return <LoginScreen />;
if (currentView === 'register') return <RegisterScreen />;
if (currentView === 'qr-register') return <QRRegisterScreen />;
if (currentView === 'role-selection') return <RoleSelectionScreen />;
if (currentView === 'add-child') return <AddChildScreen />;
if (currentView === 'group-list') return <GroupListScreen />;
if (currentView === 'create-group') return <CreateGroupScreen />;
if (currentView === 'group-chat') return <GroupChatScreen />;
if (currentView === 'parent-dashboard') return <ParentDashboard />;
if (currentView === 'child-dashboard') return <ChildDashboard />;
if (currentView === 'profile') return <ProfileScreen />;

return null;
};

export default App;