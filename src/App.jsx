import React, { useState, useEffect, useRef, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { 
  MapPin, AlertTriangle, Activity, Battery, Clock, User, Mail, 
  Shield, Users, LogOut, Navigation, Phone, MessageCircle, Calendar, Bell, Check,
  Send, X, Plus, Settings, ChevronRight, Edit, Trash2
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Supabase設定
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

console.log('Family Safe - Initializing...');
console.log('Supabase URL:', supabaseUrl);
console.log('Anon Key exists:', !!supabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('ERROR: Supabase credentials missing!');
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

console.log('Supabase client created successfully');

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
  const [batteryLevel, setBatteryLevel] = useState(null);
  const watchIdRef = useRef(null);
  const loadingRef = useRef(false);
  const batteryIntervalRef = useRef(null);
  const [showParentList, setShowParentList] = useState(false);

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

  useEffect(() => {
  const updateBattery = async () => {
    if ('getBattery' in navigator) {
      try {
        const battery = await navigator.getBattery();
        const level = Math.round(battery.level * 100);
        setBatteryLevel(level);

        // ← 追加: 充電状態が変わったときも更新
        battery.onlevelchange = () => {
          setBatteryLevel(Math.round(battery.level * 100));
        };

      } catch (error) {
        console.error('Battery API error:', error);
        setBatteryLevel(null); // ← 追加
      }
    } else {
      setBatteryLevel(null); // ← 追加: iOSなど非対応の場合
    }
  };
  updateBattery();
  // インターバルは不要になるので削除してもOK
}, [currentUser]);

  // URLハッシュを見て初期画面を決める（QRコード読み取り対応）
useEffect(() => {
  const hash = window.location.hash;
  if (hash === '#register') {
    setCurrentView('register');
const pendingShortId = sessionStorage.getItem('pendingAddShortId');
  }
  // QRコードからの追加処理
  if (hash.startsWith('#add-')) {
    const shortId = hash.replace('#add-', '');
    sessionStorage.setItem('pendingAddShortId', shortId);
    window.history.replaceState(null, '', window.location.pathname);
  }
}, []);

  useEffect(() => {
    if (!currentUser?.id) return;

    updateOnlineStatus('online');

    const heartbeatInterval = setInterval(() => {
      updateOnlineStatus('online');
    }, 5000);

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
        
        if (currentUser?.role === 'child' && currentUser?.id) {
          await supabase
            .from('members')
            .update({ battery: level })
            .eq('user_id', currentUser.id);
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

  // 保護者が子供をshort_idで追加
const handleAddByShortId = async (user, shortId) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('short_id', shortId)
      .maybeSingle();

    if (error || !profile) {
      alert('ユーザーが見つかりませんでした（ID: ' + shortId + '）');
      return;
    }
    if (profile.role !== 'child') {
      alert('このIDは子供アカウントではありません');
      return;
    }

    const { data: existing } = await supabase
      .from('parent_children')
      .select('*')
      .eq('parent_id', user.id)
      .eq('child_id', profile.id)
      .maybeSingle();

    if (existing) {
      alert(`${profile.name} は既に登録済みです`);
      return;
    }

    await supabase.from('parent_children').insert([{
      parent_id: user.id,
      child_id: profile.id
    }]);

    alert(`${profile.name} を家族に追加しました！`);
    await loadMembersData(user);
  } catch (e) {
    console.error('handleAddByShortId error:', e);
  }
};

// 子供が保護者をshort_idで追加
const handleAddParentByShortId = async (user, shortId) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('short_id', shortId)
      .maybeSingle();

    if (error || !profile) {
      alert('ユーザーが見つかりませんでした（ID: ' + shortId + '）');
      return;
    }
    if (profile.role !== 'parent') {
      alert('このIDは保護者アカウントではありません');
      return;
    }

    const { data: existing } = await supabase
      .from('parent_children')
      .select('*')
      .eq('parent_id', profile.id)
      .eq('child_id', user.id)
      .maybeSingle();

    if (existing) {
      alert(`${profile.name} は既に登録済みです`);
      return;
    }

    await supabase.from('parent_children').insert([{
      parent_id: profile.id,
      child_id: user.id
    }]);

    alert(`${profile.name} と家族でつながりました！`);
  } catch (e) {
    console.error('handleAddParentByShortId error:', e);
  }
};

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
          avatar_url: data.avatar_url,
          short_id: data.short_id
        };
        setCurrentUser(user);
        setCurrentView(user.role === 'parent' ? 'parent-dashboard' : 'child-dashboard');

        const pendingShortId = sessionStorage.getItem('pendingAddShortId');
        if (pendingShortId && user.role === 'parent') {
          sessionStorage.removeItem('pendingAddShortId');
          await handleAddByShortId(user, pendingShortId);
        } else if (pendingShortId && user.role === 'child') {
          sessionStorage.removeItem('pendingAddShortId');
          await handleAddParentByShortId(user, pendingShortId);
        }

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
            .select('id, name, avatar_url')
            .in('id', profileIds);
          
          const profileMap = {};
          if (profiles) {
            profiles.forEach(p => {
              profileMap[p.id] = { 
                name: p.name,
                avatarUrl: p.avatar_url
              };
            });
          }

          const formattedMembers = data.map(m => ({
            id: m.id,
            userId: m.user_id,
            name: profileMap[m.user_id]?.name || m.name,
            avatar: 'C',
            avatarUrl: profileMap[m.user_id]?.avatarUrl,
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

  // 活動履歴読み込み
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

  // メッセージのリアルタイム購読（親側）
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
          
          if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification('Family Safe - 新着メッセージ', {
              body: `${senderName}: ${payload.new.text}`,
              icon: '/favicon.ico',
              tag: 'message-' + payload.new.id,
              requireInteraction: false
            });
            
            notification.onclick = () => {
              window.focus();
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
              
              if (memberIds.includes(payload.new.member_id)) {
                setAlerts(prev => [{
                  id: payload.new.id,
                  type: payload.new.type,
                  memberId: payload.new.member_id,
                  message: payload.new.message,
                  timestamp: new Date(payload.new.created_at),
                  read: payload.new.read || false
                }, ...prev]);
                
                if ('Notification' in window && Notification.permission === 'granted') {
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

    if ('Notification' in window && Notification.permission === 'granted') {
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
          // ★★★ 変更がない場合は何もしない ★★★
          setMembers(prev => {
            const current = prev.find(m => m.id === member.id);
            if (!current) return prev;
            
            // 値が変わっていなければ更新しない
            const newGpsActive = payload.new.gps_enabled;
            const newLat = payload.new.latitude;
            const newLng = payload.new.longitude;
            const newBattery = payload.new.battery;

            if (current.gpsActive === newGpsActive && 
              current.location.lat === newLat && 
              current.location.lng === newLng &&
              current.battery === newBattery) { 
            return prev;
            }
            
            // 変更がある場合のみ更新
            return prev.map(m => 
              m.id === member.id ? { 
                ...m, 
                gpsActive: newGpsActive,
                isMoving: newGpsActive,
                location: {
                  lat: newLat || m.location.lat,
                  lng: newLng || m.location.lng,
                  address: payload.new.address || m.location.address
                },
                battery: payload.new.battery || m.battery,
                lastUpdate: new Date(payload.new.last_update || Date.now())
              } : m
            );
          });
        }
      )
      .subscribe();
    
    return channel;
  });

  return () => {
    channels.forEach(channel => supabase.removeChannel(channel));
  };
}, [currentUser, members.length]);

  // GPS追跡開始（親が子供のGPSを遠隔制御）
  const startGPSTracking = async (memberId) => {
    try {
      await supabase
        .from('members')
        .update({ gps_enabled: true })
        .eq('id', memberId);
      
      if ('Notification' in window && Notification.permission === 'granted') {
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
          await supabase
            .from('location_history')
            .insert([{
              member_id: memberId,
              latitude,
              longitude,
              address: `緯度: ${latitude.toFixed(4)}, 経度: ${longitude.toFixed(4)}`
            }]);
          
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

  // ========== 画面コンポーネント ==========

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

            <div className="info-box-blue">
              <p>
                スマホで登録する場合
              </p>
              <button
                onClick={() => setCurrentView('qr-register')}
                className="login-btn primary"
                disabled={loading}
              >
                QRコードを表示する
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // QRコード登録画面
  const QRRegisterScreen = () => {
    const [copied, setCopied] = useState(false);
    const registerUrl = `${window.location.origin}/#register`;

    const copyUrl = async () => {
      try {
        await navigator.clipboard.writeText(registerUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        alert('コピーに失敗しました。URLを手動でコピーしてください。');
      }
    };

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
              <Shield size={64} />
            </div>
            <h1>QRコードで登録</h1>
            <p>スマホでQRコードを読み取ってください</p>
          </div>

          <div className="register-form">
            <div className="info-box-blue">
              <p>
                <strong>使い方：</strong><br/>
                スマホのカメラでQRコードを読み取る<br/>
                自動でブラウザが開く<br/>
                そのまま新規登録できます！
              </p>
            </div>

            <div className="qr-code-wrapper">
              <QRCodeCanvas
                value={registerUrl}
                size={250}
                bgColor="#ffffff"
                fgColor="#667eea"
                level="M"
                includeMargin={true}
              />
              <p>スマホのカメラで読み取ってください</p>
            </div>

            <div>
              <p>QRコードが読めない場合は、このURLをLINEやメールで送ってください：</p>
              <div className="url-copy-box">
                <div className="url-display">
                  {registerUrl}
                </div>
                <button
                  onClick={copyUrl}
                  className={`copy-url-btn ${copied ? 'copied' : ''}`}
                >
                  {copied ? 'コピー済' : 'コピー'}
                </button>
              </div>
            </div>

            <button
              onClick={shareUrl}
              className="share-url-btn"
            >
              URLを共有する（LINE・メール等）
            </button>

            <button
              onClick={() => setCurrentView('login')}
              className="register-btn"
            >
              ログイン画面に戻る
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

// 修正後
const { data: shortIdData } = await supabase.rpc('generate_unique_short_id');
const { error: profileError } = await supabase
  .from('profiles')
  .upsert([{
    id: authData.user.id,
    name: formData.name,
    role: formData.role,
    phone: formData.phone,
    email: formData.email,
    short_id: shortIdData,
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

const { data: shortIdData } = await supabase.rpc('generate_unique_short_id');
const { error: profileError } = await supabase
  .from('profiles')
  .upsert([{
    id: currentUser.id,
    name: name,
    role: selectedRole,
    phone: phone,
    email: currentUser.email,
    short_id: shortIdData,
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
            <div className="info-box-yellow">
              <p>
                <strong>プロファイル情報が見つかりません。</strong><br/>
                アカウントタイプと名前を設定して、登録を完了してください。
              </p>
            </div>

            <div className="info-box-blue">
              <p>
                <Mail size={16} /> {currentUser?.email}
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

const ProfileScreen = () => {
  const [uploading, setUploading] = useState(false);
  const isChild = currentUser?.role === 'child';
  const myProfile = members?.find(m => m.userId === currentUser?.id);

  const uploadAvatar = async (event) => {
    try {
      setUploading(true);
      if (!event.target.files || event.target.files.length === 0) return;
      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}-${Math.random()}.${fileExt}`;

      if (currentUser.avatar_url) {
        const oldPath = currentUser.avatar_url.split('/').pop();
        await supabase.storage.from('avatars').remove([oldPath]);
      }
      const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, file);
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
      await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', currentUser.id);
      setCurrentUser({ ...currentUser, avatar_url: data.publicUrl });
      alert('プロフィール画像を更新しました！');
    } catch (error) {
      alert('画像のアップロードに失敗しました: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  // ── 子供：既存デザイン ────────────────────────────────────
  if (isChild) {
    const batteryColor =
      (myProfile?.battery ?? batteryLevel) >= 60 ? '#22c55e' :
      (myProfile?.battery ?? batteryLevel) >= 30 ? '#f59e0b' : '#ef4444';
    const statusLabel =
      myProfile?.status === 'safe' ? '安全' :
      myProfile?.status === 'warning' ? '道に迷ってる' : '緊急';
    const statusBg =
      myProfile?.status === 'safe' ? '#d1fae5' :
      myProfile?.status === 'warning' ? '#fef3c7' : '#fee2e2';
    const statusColor =
      myProfile?.status === 'safe' ? '#065f46' :
      myProfile?.status === 'warning' ? '#92400e' : '#991b1b';

    return (
      <div className="child-dashboard">
        <header className="child-header">
          <h1>プロフィール</h1>
        </header>

        <div className="child-content">
          <div className="status-card" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: '1rem' }}>
              <div style={{
                width: 88, height: 88, borderRadius: '50%',
                background: 'linear-gradient(135deg,#667eea,#764ba2)', padding: 3,
              }}>
                <div style={{
                  width: '100%', height: '100%', borderRadius: '50%', background: '#fff',
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {currentUser?.avatar_url
                    ? <img src={currentUser.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 36, fontWeight: 700, color: '#667eea' }}>{currentUser?.name?.charAt(0) || '😊'}</span>}
                </div>
              </div>
              <label style={{
                position: 'absolute', bottom: 0, right: 0, width: 28, height: 28,
                borderRadius: '50%', background: 'linear-gradient(135deg,#667eea,#764ba2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,.2)',
              }}>
                {uploading ? <span style={{ fontSize: 10, color: '#fff' }}>…</span> : <User size={13} color="#fff" />}
                <input type="file" accept="image/*" onChange={uploadAvatar} disabled={uploading} style={{ display: 'none' }} />
              </label>
            </div>
            <h2 style={{ margin: '0 0 .5rem', fontSize: '1.4rem', fontWeight: 800, color: '#1a1a2e' }}>{currentUser?.name}</h2>
            <div className="status-indicator" style={{ background: statusBg, color: statusColor, justifyContent: 'center', display: 'inline-flex', borderRadius: 20 }}>
              {myProfile?.status === 'safe' ? <Check size={18} /> : myProfile?.status === 'warning' ? <Navigation size={18} /> : <AlertTriangle size={18} />}
              <span>{statusLabel}</span>
            </div>
          </div>

          <div className="child-info-grid">
            <div className="info-box">
              <Battery size={22} color={batteryColor} className="info-icon" />
              <div><h3>バッテリー</h3><div className="info-value" style={{ color: batteryColor }}>{myProfile?.battery != null ? `${myProfile.battery}%` : '不明'}</div></div>
            </div>
            <div className="info-box">
              <Navigation size={22} color={gpsEnabled ? '#667eea' : '#aaa'} className="info-icon" />
              <div><h3>GPS</h3><div className="info-value" style={{ fontSize: '0.95rem', color: gpsEnabled ? '#667eea' : '#aaa' }}>{gpsEnabled ? '追跡中' : 'オフ'}</div></div>
            </div>
          </div>

          {myProfile && (
            <div className="destination-card" style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', borderRadius: 20 }}>
              <h2 style={{ color: 'rgba(255,255,255,.8)', fontSize: '.8rem', marginBottom: '.5rem' }}>
                <MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />現在地
              </h2>
              <div className="current-location">
                <p style={{ color: '#fff', fontWeight: 600, fontSize: '.95rem' }}>{myProfile.location?.address || '位置情報未取得'}</p>
              </div>
              <p style={{ fontSize: '.78rem', color: 'rgba(255,255,255,.65)', marginTop: '.5rem' }}>
                最終更新: {myProfile.lastUpdate?.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}

          <div className="status-card">
            <h2 style={{ fontSize: '.8rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '.75rem' }}>アカウント情報</h2>
            {[
              { icon: <User size={18} color="#667eea" />, label: '名前', value: currentUser?.name },
              { icon: <Mail size={18} color="#ec4899" />, label: 'メール', value: currentUser?.email },
              currentUser?.phone && { icon: <Phone size={18} color="#22c55e" />, label: '電話番号', value: currentUser.phone },
              { icon: <Shield size={18} color="#f59e0b" />, label: 'アカウント', value: '子どもアカウント' },
            ].filter(Boolean).map((row, i, arr) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '.75rem 0' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f8f8ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{row.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 11, color: '#aaa', fontWeight: 600 }}>{row.label}</p>
                    <p style={{ margin: 0, fontSize: 14, color: '#222', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.value}</p>
                  </div>
                </div>
                {i < arr.length - 1 && <div style={{ height: 1, background: '#f0f0f0' }} />}
              </div>
            ))}
          </div>

          <button className="gps-toggle" onClick={() => setCurrentView('group-list')} style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', color: '#fff', border: 'none' }}>
            <Users size={18} /> グループチャット
          </button>
          <button className="gps-toggle" onClick={() => setCurrentView('child-dashboard')} style={{ background: '#fff', color: '#667eea', border: '2px solid #667eea' }}>
            ← ダッシュボードへ戻る
          </button>
          <button onClick={async () => {
            if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
            await supabase.auth.signOut(); setCurrentUser(null); setCurrentView('login');
          }} style={{ width: '100%', padding: '.875rem', background: 'rgba(239,68,68,.08)', color: '#ef4444', border: '1.5px solid rgba(239,68,68,.2)', borderRadius: 16, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <LogOut size={18} /> ログアウト
          </button>
          <div style={{ height: 24 }} />
        </div>
      </div>
    );
  }

  // ── 保護者：リデザイン版 ──────────────────────────────────
  const childCount = members?.length || 0;
  const safeCount = members?.filter(m => m.status === 'safe').length || 0;
  const activeGpsCount = members?.filter(m => m.gpsActive).length || 0;

  return (
    <div className="dashboard" style={{ background: 'linear-gradient(160deg,#f0f4ff 0%,#f8f9fa 100%)', minHeight: '100vh' }}>

      {/* ── ヘッダー ── */}
      <header className="dashboard-header" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="header-left">
          <h1>プロフィール</h1>
          <p>アカウント設定</p>
        </div>
      </header>

      {/* ── スクロールコンテンツ ── */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '1.5rem 1.25rem 3rem' }}>

        {/* ── ヒーローカード ── */}
        <div style={{
          background: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
          borderRadius: 24, padding: '2rem 1.5rem',
          textAlign: 'center', marginBottom: '1.25rem',
          boxShadow: '0 8px 32px rgba(102,126,234,.3)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* 背景デコ */}
          <div style={{
            position: 'absolute', top: -40, right: -40,
            width: 160, height: 160, borderRadius: '50%',
            background: 'rgba(255,255,255,.07)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: -30, left: -30,
            width: 120, height: 120, borderRadius: '50%',
            background: 'rgba(255,255,255,.05)', pointerEvents: 'none',
          }} />

          {/* アバター */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '1.25rem' }}>
            <div style={{
              width: 96, height: 96, borderRadius: '50%',
              background: 'rgba(255,255,255,.2)', padding: 3,
              boxShadow: '0 0 0 4px rgba(255,255,255,.25)',
            }}>
              <div style={{
                width: '100%', height: '100%', borderRadius: '50%',
                background: 'rgba(255,255,255,.15)', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {currentUser?.avatar_url
                  ? <img src={currentUser.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 40, fontWeight: 800, color: '#fff' }}>{currentUser?.name?.charAt(0) || 'P'}</span>}
              </div>
            </div>
            {/* カメラボタン */}
            <label style={{
              position: 'absolute', bottom: 2, right: 2,
              width: 30, height: 30, borderRadius: '50%',
              background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', border: '2px solid rgba(102,126,234,.4)',
              boxShadow: '0 2px 8px rgba(0,0,0,.2)',
            }}>
              {uploading
                ? <span style={{ fontSize: 10, color: '#667eea' }}>…</span>
                : <User size={14} color="#667eea" />}
              <input type="file" accept="image/*" onChange={uploadAvatar} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>

          <h2 style={{ margin: '0 0 .25rem', color: '#fff', fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-.5px' }}>
            {currentUser?.name}
          </h2>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,.2)', borderRadius: 20,
            padding: '4px 14px', marginTop: 6,
          }}>
            <Shield size={13} color="rgba(255,255,255,.9)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.95)' }}>保護者アカウント</span>
          </div>
        </div>

        {/* ── 家族ステータスグリッド ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
          gap: '0.875rem', marginBottom: '1.25rem',
        }}>
          {[
            { icon: <Users size={20} color="#667eea" />, label: '管理中', value: `${childCount}人`, bg: '#ede9fe', accent: '#667eea' },
            { icon: <Check size={20} color="#10b981" />, label: '安全確認', value: `${safeCount}人`, bg: '#d1fae5', accent: '#10b981' },
            { icon: <Navigation size={20} color="#f59e0b" />, label: 'GPS追跡中', value: `${activeGpsCount}人`, bg: '#fef3c7', accent: '#f59e0b' },
          ].map((s, i) => (
            <div key={i} style={{
              background: '#fff', borderRadius: 18, padding: '1rem .75rem',
              textAlign: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.07)',
              border: `1.5px solid ${s.accent}22`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: s.bg, margin: '0 auto .5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{s.icon}</div>
              <p style={{ margin: 0, fontSize: 11, color: '#aaa', fontWeight: 600 }}>{s.label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800, color: '#222' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── アカウント情報カード ── */}
        <div style={{
          background: '#fff', borderRadius: 20, padding: '1.25rem',
          marginBottom: '1.25rem', boxShadow: '0 4px 16px rgba(0,0,0,.07)',
        }}>
          <p style={{ margin: '0 0 .75rem', fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 }}>
            アカウント情報
          </p>
          {[
            { icon: <User size={17} color="#667eea" />, label: '名前', value: currentUser?.name },
            { icon: <Mail size={17} color="#ec4899" />, label: 'メールアドレス', value: currentUser?.email },
            currentUser?.phone && { icon: <Phone size={17} color="#22c55e" />, label: '電話番号', value: currentUser.phone },
            { icon: <Shield size={17} color="#f59e0b" />, label: 'アカウント種別', value: '保護者' },
          ].filter(Boolean).map((row, i, arr) => (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '.75rem 0' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11,
                  background: '#f4f5ff', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{row.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#bbb', fontWeight: 600 }}>{row.label}</p>
                  <p style={{ margin: 0, fontSize: 14, color: '#222', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.value}</p>
                </div>
              </div>
              {i < arr.length - 1 && <div style={{ height: 1, background: '#f4f4f4' }} />}
            </div>
          ))}
        </div>

        {/* ── 子供一覧カード ── */}
        {members && members.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: 20, padding: '1.25rem',
            marginBottom: '1.25rem', boxShadow: '0 4px 16px rgba(0,0,0,.07)',
          }}>
            <p style={{ margin: '0 0 .875rem', fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 }}>
              管理中の子ども
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
              {members.map((member, i) => {
                const sc = member.status === 'safe' ? '#10b981' : member.status === 'warning' ? '#f59e0b' : '#ef4444';
                return (
                  <div key={member.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '.875rem', background: '#f8f9ff',
                    borderRadius: 14, border: '1.5px solid #eef0ff',
                    cursor: 'pointer', transition: 'box-shadow .15s',
                  }}
                    onClick={() => setCurrentView('parent-dashboard')}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(102,126,234,.15)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    {/* アバター */}
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                      background: member.avatarUrl ? '#fff' : 'linear-gradient(135deg,#667eea,#764ba2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', border: member.avatarUrl ? '2px solid #e9ecef' : 'none',
                      position: 'relative',
                    }}>
                      {member.avatarUrl
                        ? <img src={member.avatarUrl} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>{member.name?.charAt(0)}</span>}
                      {/* ステータスドット */}
                      <div style={{
                        position: 'absolute', bottom: 1, right: 1,
                        width: 12, height: 12, borderRadius: '50%',
                        background: sc, border: '2px solid #fff',
                      }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#222' }}>{member.name}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.location?.address || '位置情報なし'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Battery size={13} color={member.battery >= 30 ? '#22c55e' : '#ef4444'} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>{member.battery}%</span>
                      </div>
                      {member.gpsActive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#667eea' }}>
                          <Navigation size={12} />
                          <span style={{ fontSize: 11, fontWeight: 600 }}>追跡中</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 保護者のQRコード表示カード */}
{currentUser?.short_id && (
  <div style={{
    background: '#fff', borderRadius: 20, padding: '1.25rem',
    marginBottom: '1.25rem', boxShadow: '0 4px 16px rgba(0,0,0,.07)',
    textAlign: 'center'
  }}>
    <p style={{margin: '0 0 .75rem', fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1}}>
      あなたのID（子供に読み取ってもらう）
    </p>
    <div style={{
      fontSize: '2.5rem', fontWeight: '800', letterSpacing: '0.3em',
      color: '#667eea', marginBottom: '1rem'
    }}>
      {currentUser.short_id}
    </div>
    <QRCodeCanvas
      value={`${window.location.origin}/#add-${currentUser.short_id}`}
      size={180}
      bgColor="#ffffff"
      fgColor="#667eea"
      level="M"
      includeMargin={true}
    />
    <p style={{fontSize:'0.8rem', color:'#999', marginTop:'0.5rem'}}>
      子供がカメラで読み取ると自動追加されます
    </p>
  </div>
)}

        {/* ── アクションボタン ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <button
            onClick={() => setCurrentView('group-list')}
            style={{
              width: '100%', padding: '1rem',
              background: 'linear-gradient(135deg,#667eea,#764ba2)',
              color: '#fff', border: 'none', borderRadius: 16,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 4px 16px rgba(102,126,234,.3)',
              transition: 'transform .15s, box-shadow .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(102,126,234,.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 16px rgba(102,126,234,.3)'; }}
          >
            <Users size={18} /> グループチャット
          </button>

          <button
            onClick={() => setCurrentView('add-child')}
            style={{
              width: '100%', padding: '1rem',
              background: '#fff', color: '#667eea',
              border: '2px solid #667eea', borderRadius: 16,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
          >
            <Plus size={18} /> 子どもを追加
          </button>

          <button
            onClick={() => setCurrentView('parent-dashboard')}
            style={{
              width: '100%', padding: '1rem',
              background: '#f4f5ff', color: '#667eea',
              border: 'none', borderRadius: 16,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            ← ダッシュボードへ戻る
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
            style={{
              width: '100%', padding: '1rem',
              background: 'rgba(239,68,68,.07)', color: '#ef4444',
              border: '1.5px solid rgba(239,68,68,.2)', borderRadius: 16,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,.07)'}
          >
            <LogOut size={18} /> ログアウト
          </button>
        </div>

        <div style={{ height: 16 }} />
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
    setError('子供のIDを入力してください');
    return;
  }

  setLoading(true);
  setError('');
  setSuccess('');

  const trimmedId = childId.trim();

  // 6桁数字チェック
  if (!/^\d{6}$/.test(trimmedId)) {
    setError('6桁の数字を入力してください');
    setLoading(false);
    return;
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('short_id', trimmedId)
      .maybeSingle();

    if (profileError || !profile) {
      setError('ユーザーが見つかりませんでした');
      setLoading(false);
      return;
    }

    if (profile.role !== 'child') {
      setError('このIDは子供アカウントではありません');
      setLoading(false);
      return;
    }

    const { data: existing } = await supabase
      .from('parent_children')
      .select('*')
      .eq('parent_id', currentUser.id)
      .eq('child_id', profile.id)
      .maybeSingle();

    if (existing) {
      setError(`${profile.name} は既に登録済みです`);
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from('parent_children')
      .insert([{
        parent_id: currentUser.id,
        child_id: profile.id
      }]);

    if (insertError) {
      setError('登録に失敗しました: ' + insertError.message);
      setLoading(false);
      return;
    }

    setSuccess(`${profile.name} を登録しました！`);
    setChildId('');
    await loadMembersData(currentUser);
    setTimeout(() => setCurrentView('parent-dashboard'), 1500);
  } catch (e) {
    setError('エラーが発生しました: ' + e.message);
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
            <div className="info-box-blue">
              <p>
                子供アカウントのユーザーIDは、子供のプロフィール画面で確認できます。
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="child-id">子供のユーザーID</label>
              <div className="url-copy-box">
                <input
                  id="child-id"
                  type="text"
                  value={childId}
                  onChange={(e) => setChildId(e.target.value)}
                  placeholder="例: 550e8400-e29b-41d4-a716-446655440000"
                  disabled={loading}
                  className="url-display"
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
                  className="copy-url-btn"
                >
                  貼り付け
                </button>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

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

// 1. グループ一覧画面（完全修正版）
const GroupListScreen = () => {
  const [myGroups, setMyGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

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
            
            const { data: lastMessage } = await supabase
              .from('group_messages')
              .select('text, created_at')
              .eq('group_id', group.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();
            
            const { data: allMessages } = await supabase
              .from('group_messages')
              .select('id')
              .eq('group_id', group.id);
            
            const { data: readMessages } = await supabase
              .from('group_message_reads')
              .select('message_id')
              .eq('user_id', currentUser.id);
            
            const readMessageIds = readMessages?.map(r => r.message_id) || [];
            const unreadCount = allMessages?.filter(m => !readMessageIds.includes(m.id)).length || 0;
            
            return {
              ...group,
              memberCount: members?.length || 0,
              lastMessage: lastMessage?.text || '',
              lastMessageTime: lastMessage?.created_at ? new Date(lastMessage.created_at) : null,
              unreadCount: unreadCount
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

  const filteredGroups = myGroups.filter(group => 
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '1.5rem 1.25rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{
          fontSize: '1.75rem',
          color: 'white',
          margin: 0,
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <Users size={32} />
          グループ
        </h1>
        <button 
          onClick={() => setCurrentView(currentUser?.role === 'parent' ? 'parent-dashboard' : 'child-dashboard')}
          style={{
            padding: '0.5rem 1.25rem',
            background: 'rgba(255,255,255,0.2)',
            color: 'white',
            border: '2px solid rgba(255,255,255,0.4)',
            borderRadius: '25px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.95rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s',
            backdropFilter: 'blur(10px)'
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

      {/* 検索バー */}
      <div style={{padding: '0 1.25rem 1.5rem'}}>
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center'
        }}>
          <i className="fas fa-search" style={{
            position: 'absolute',
            left: '1.25rem',
            color: '#999',
            fontSize: '1rem',
            zIndex: 1
          }}></i>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="グループを検索..."
            style={{
              width: '100%',
              padding: '1rem 1rem 1rem 3.25rem',
              background: 'white',
              border: 'none',
              borderRadius: '16px',
              fontSize: '1rem',
              outline: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '1rem',
                background: '#f0f0f0',
                border: 'none',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666',
                cursor: 'pointer',
                zIndex: 1
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 新規作成ボタン */}
      <div style={{padding: '0 1.25rem 1.5rem'}}>
        <button
          onClick={() => setCurrentView('create-group')}
          style={{
            width: '100%',
            padding: '1.25rem',
            background: 'white',
            color: '#667eea',
            border: 'none',
            borderRadius: '16px',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '1.05rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
        >
          <Plus size={24} />
          新しいグループを作成
        </button>
      </div>

      {/* コンテンツエリア（灰色背景） - グループリストを含む */}
      <div style={{
        background: '#f5f5f5',
        flex: 1,
        paddingBottom: '2rem'
      }}>
        {/* グループリスト */}
        {filteredGroups.length === 0 ? (
          <div style={{
            background: 'white',
            margin: '1rem 1.25rem',
            padding: '3rem 2rem',
            borderRadius: '16px',
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem'
            }}>
              <Users size={40} style={{color: '#667eea', opacity: 0.6}} />
            </div>
            <h3 style={{
              color: '#333',
              marginBottom: '0.5rem',
              fontSize: '1.25rem',
              fontWeight: '600'
            }}>
              {searchQuery ? '検索結果なし' : 'グループがありません'}
            </h3>
            <p style={{
              color: '#999',
              fontSize: '0.95rem',
              lineHeight: '1.6',
              maxWidth: '300px',
              margin: '0 auto'
            }}>
              {searchQuery 
                ? `"${searchQuery}" に一致するグループが見つかりませんでした`
                : '新しいグループを作成して、家族や友達とチャットを始めましょう'
              }
            </p>
          </div>
        ) : (
          <div style={{
            background: 'white',
            margin: '1rem 1.25rem',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            {filteredGroups.map((group, index) => (
              <div
                key={group.id}
                onClick={() => {
                  sessionStorage.setItem('selectedGroupId', group.id);
                  setCurrentView('group-chat');
                }}
                style={{
                  padding: '1rem 1.25rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  borderBottom: index < filteredGroups.length - 1 ? '1px solid #f0f0f0' : 'none',
                  background: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  position: 'relative'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#fafafa';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'white';
                }}
              >
                <div style={{
                  position: 'relative',
                  flexShrink: 0
                }}>
                  <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: group.avatar_url 
                      ? 'white' 
                      : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    border: group.avatar_url ? '2px solid #f0f0f0' : 'none',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
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
                      <Users size={28} style={{color: 'white'}} />
                    )}
                  </div>
                  {group.unreadCount > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '-4px',
                      right: '-4px',
                      minWidth: '22px',
                      height: '22px',
                      borderRadius: '11px',
                      background: '#ef4444',
                      color: 'white',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 0.35rem',
                      border: '2px solid white',
                      boxShadow: '0 2px 4px rgba(239, 68, 68, 0.3)'
                    }}>
                      {group.unreadCount > 99 ? '99+' : group.unreadCount}
                    </div>
                  )}
                </div>

                <div style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem'
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '1.05rem',
                      color: '#333',
                      fontWeight: '600',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1
                    }}>
                      {group.name}
                    </h3>
                    {group.lastMessageTime && (
                      <span style={{
                        fontSize: '0.75rem',
                        color: '#999',
                        flexShrink: 0
                      }}>
                        {(() => {
                          const now = new Date();
                          const diff = now - group.lastMessageTime;
                          const minutes = Math.floor(diff / 60000);
                          const hours = Math.floor(diff / 3600000);
                          const days = Math.floor(diff / 86400000);
                          
                          if (minutes < 1) return 'たった今';
                          if (minutes < 60) return `${minutes}分前`;
                          if (hours < 24) return `${hours}時間前`;
                          if (days < 7) return `${days}日前`;
                          return group.lastMessageTime.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
                        })()}
                      </span>
                    )}
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {group.lastMessage ? (
                      <p style={{
                        margin: 0,
                        fontSize: '0.9rem',
                        color: group.unreadCount > 0 ? '#333' : '#999',
                        fontWeight: group.unreadCount > 0 ? '500' : '400',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1
                      }}>
                        {group.lastMessage}
                      </p>
                    ) : (
                      <p style={{
                        margin: 0,
                        fontSize: '0.9rem',
                        color: '#ccc',
                        fontStyle: 'italic',
                        flex: 1
                      }}>
                        メッセージがありません
                      </p>
                    )}
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    marginTop: '0.15rem'
                  }}>
                    <Users size={13} style={{color: '#999'}} />
                    <span style={{
                      fontSize: '0.8rem',
                      color: '#999'
                    }}>
                      {group.memberCount}人のメンバー
                    </span>
                  </div>
                </div>

                <div style={{
                  flexShrink: 0,
                  color: '#ddd'
                }}>
                  <ChevronRight size={20} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// 2. グループ作成画面（完全修正版）
const CreateGroupScreen = () => {
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [availableMembers, setAvailableMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [step, setStep] = useState(1);
  const fileInputRef = useRef(null);
  const [groupImage, setGroupImage] = useState(null);
  const [groupImagePreview, setGroupImagePreview] = useState(null);

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
            .select('id, name, role, avatar_url')
            .in('id', childIds);
          
          if (profiles) {
            setAvailableMembers(profiles.map(p => ({
              id: p.id,
              name: p.name,
              role: p.role,
              avatarUrl: p.avatar_url
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
            .select('id, name, role, avatar_url')
            .in('id', parentIds);
          
          if (profiles) {
            setAvailableMembers(profiles.map(p => ({
              id: p.id,
              name: p.name,
              role: p.role,
              avatarUrl: p.avatar_url
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

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setGroupImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setGroupImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
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
      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert([{
          name: groupName,
          created_by: currentUser.id
        }])
        .select()
        .single();

      if (groupError) {
        console.error('Group creation error:', groupError);
        alert('グループの作成に失敗しました: ' + groupError.message);
        setLoading(false);
        return;
      }

      if (groupImage) {
        try {
          const fileExt = groupImage.name.split('.').pop();
          const fileName = `${newGroup.id}-${Math.random()}.${fileExt}`;
          const filePath = `group-images/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, groupImage);

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('avatars')
              .getPublicUrl(filePath);

            await supabase
              .from('groups')
              .update({ avatar_url: publicUrl })
              .eq('id', newGroup.id);
          }
        } catch (error) {
          console.error('Image upload error:', error);
        }
      }

      const membersToAdd = [currentUser.id, ...selectedMembers];
      
      const { error: membersError } = await supabase
        .from('group_members')
        .insert(
          membersToAdd.map(userId => ({
            group_id: newGroup.id,
            user_id: userId
          }))
        );

      if (membersError) {
        console.error('Add members error:', membersError);
        alert('メンバーの追加に失敗しました: ' + membersError.message);
        setLoading(false);
        return;
      }

      alert('グループを作成しました！');
      setCurrentView('group-list');
    } catch (error) {
      console.error('Unexpected error:', error);
      alert('エラーが発生しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredMembers = availableMembers.filter(member =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '1.5rem 1.25rem 1rem'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem'
        }}>
          <button
            onClick={() => setCurrentView('group-list')}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem'
            }}
          >
            <i className="fas fa-arrow-left"></i>
            <span>戻る</span>
          </button>
          
          <h1 style={{
            fontSize: '1.25rem',
            color: 'white',
            margin: 0,
            fontWeight: '700'
          }}>
            新規グループ
          </h1>
          
          <div style={{width: '70px'}}></div>
        </div>

        {/* プログレスバー */}
        <div style={{
          display: 'flex',
          gap: '0.5rem'
        }}>
          <div style={{
            flex: 1,
            height: '4px',
            borderRadius: '2px',
            background: step >= 1 ? 'white' : 'rgba(255,255,255,0.3)',
            transition: 'all 0.3s'
          }}></div>
          <div style={{
            flex: 1,
            height: '4px',
            borderRadius: '2px',
            background: step >= 2 ? 'white' : 'rgba(255,255,255,0.3)',
            transition: 'all 0.3s'
          }}></div>
        </div>
      </div>

      {/* コンテンツエリア */}
      <div style={{
        flex: 1, 
        overflowY: 'auto',
        background: '#f5f5f5'
      }}>

        {step === 1 ? (
          <div style={{
            padding: '1rem 1.25rem', 
            paddingBottom: '2rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 'calc(100vh - 200px)'
          }}>
            <div style={{
              textAlign: 'center',
              marginBottom: '2rem',
              width: '100%',
              maxWidth: '400px'
            }}>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100px',
                  height: '100px',
                  borderRadius: '50%',
                  background: groupImagePreview 
                    ? `url(${groupImagePreview})` 
                    : 'rgba(255,255,255,0.2)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  margin: '0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  position: 'relative',
                  border: '3px dashed',
                  borderColor: groupImagePreview ? 'transparent' : 'rgba(98, 113, 223, 0.82)',
                  transition: 'all 0.2s',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {!groupImagePreview && (
                  <div style={{textAlign: 'center'}}>
                    <i className="fas fa-camera" style={{
                      fontSize: '2rem',
                      color: '#667eea',
                      marginBottom: '0.25rem'
                    }}></i>
                    <div style={{
                      fontSize: '0.7rem',
                      color: '#667eea',
                      fontWeight: '600'
                    }}>
                      画像追加
                    </div>
                  </div>
                )}
                {groupImagePreview && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#667eea',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '3px solid rgba(255, 255, 255, 0.5)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                  }}>
                    <i className="fas fa-camera" style={{
                      fontSize: '0.9rem',
                      color: '#667eea'
                    }}></i>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                style={{display: 'none'}}
              />
              <p style={{
                marginTop: '1rem',
                fontSize: '0.85rem',
                color: '#667eea'
              }}>
                グループアイコンを設定（任意）
              </p>
            </div>

            <div style={{
              background: 'white',
              borderRadius: '16px',
              padding: '1.5rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              marginBottom: '1.5rem',
              width: '100%',
              maxWidth: '400px'  
            }}>
              <label style={{
                display: 'block',
                marginBottom: '0.75rem',
                color: '#333',
                fontWeight: '600',
                fontSize: '0.95rem'
              }}>
                グループ名
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="例: 家族グループ"
                maxLength={50}
                style={{
                  width: '100%',
                  padding: '1rem',
                  border: '2px solid #f0f0f0',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  outline: 'none',
                  transition: 'all 0.2s',
                  background: '#fafafa'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#667eea';
                  e.target.style.background = '#fff';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#f0f0f0';
                  e.target.style.background = '#fafafa';
                }}
              />
              <div style={{
                marginTop: '0.5rem',
                fontSize: '0.8rem',
                color: '#999',
                textAlign: 'right'
              }}>
                {groupName.length} / 50
              </div>
            </div>

            <button
              onClick={() => {
                if (!groupName.trim()) {
                  alert('グループ名を入力してください');
                  return;
                }
                setStep(2);
              }}
              style={{
                width: '100%',
                padding: '1rem',
                background: groupName.trim() 
                  ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
                  : 'white',
                color: groupName.trim() ? '#ffffff' : 'rgba(255,255,255,0.7)',
                border: 'none',
                borderRadius: '16px',
                cursor: groupName.trim() ? 'pointer' : 'not-allowed',
                fontWeight: '700',
                fontSize: '1.05rem',
                boxShadow: groupName.trim() ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                transition: 'all 0.2s'
              }}
              disabled={!groupName.trim()}
              onMouseEnter={(e) => {
                if (groupName.trim()) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = groupName.trim() ? '0 4px 12px rgba(0,0,0,0.15)' : 'none';
              }}
            >
              次へ
            </button>
          </div>
        ) : (
          <div>
            {/* 検索バー */}
            <div style={{
              padding: '0 1.25rem 1rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              position: 'sticky',
              top: 0,
              zIndex: 50
            }}>
              <div style={{position: 'relative'}}>
                <i className="fas fa-search" style={{
                  position: 'absolute',
                  left: '1.25rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#999',
                  fontSize: '1rem',
                  zIndex: 1
                }}></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="メンバーを検索..."
                  style={{
                    width: '100%',
                    padding: '1rem 3.5rem 1rem 3.25rem',
                    background: 'white',
                    border: 'none',
                    borderRadius: '16px',
                    fontSize: '1rem',
                    outline: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '1rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#f0f0f0',
                      border: 'none',
                      borderRadius: '50%',
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#666',
                      cursor: 'pointer',
                      zIndex: 1
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* 選択中のメンバー表示 */}
            {selectedMembers.length > 0 && (
              <div style={{
                padding: '1rem 1.25rem',
                background: 'white',
                borderBottom: '8px solid #f5f5f5'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.75rem'
                }}>
                  <span style={{
                    fontSize: '0.85rem',
                    color: '#667eea',
                    fontWeight: '600'
                  }}>
                    選択中: {selectedMembers.length}人
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem'
                }}>
                  {selectedMembers.map(memberId => {
                    const member = availableMembers.find(m => m.id === memberId);
                    if (!member) return null;
                    return (
                      <div
                        key={memberId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.5rem 0.75rem',
                          background: '#f0f4ff',
                          borderRadius: '20px',
                          border: '1px solid #667eea'
                        }}
                      >
                        <span style={{
                          fontSize: '0.9rem',
                          color: '#667eea',
                          fontWeight: '500'
                        }}>
                          {member.name}
                        </span>
                        <button
                          onClick={() => toggleMember(memberId)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#667eea',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 登録済みメンバー一覧 */}
            <div style={{
              background: 'white',
              borderBottom: '8px solid #f5f5f5'
            }}>
              <div style={{
                padding: '1rem 1.25rem 0.5rem',
                fontSize: '0.85rem',
                color: '#999',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                登録されているメンバー ({availableMembers.length}人)
              </div>
              {filteredMembers.length === 0 ? (
                <div style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: '#999'
                }}>
                  <User size={40} style={{marginBottom: '1rem', opacity: 0.5}} />
                  <p style={{margin: 0, fontSize: '0.95rem'}}>
                    {searchQuery ? `"${searchQuery}" に一致するメンバーがいません` : 'メンバーがいません'}
                  </p>
                </div>
              ) : (
                filteredMembers.map((member, index) => {
                  const isSelected = selectedMembers.includes(member.id);
                  return (
                    <div
                      key={member.id}
                      onClick={() => toggleMember(member.id)}
                      style={{
                        padding: '1rem 1.25rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        borderBottom: index < filteredMembers.length - 1 ? '1px solid #f0f0f0' : 'none',
                        background: isSelected ? '#f0f4ff' : 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem'
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = '#fafafa';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = 'white';
                        }
                      }}
                    >
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: member.avatarUrl 
                          ? 'white' 
                          : (member.role === 'parent' 
                            ? 'linear-gradient(135deg, #667eea 0%, #d97706 100%)' 
                            : 'linear-gradient(135deg, #47484c 0%, #764ba2 100%)'),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        border: member.avatarUrl ? '2px solid #f0f0f0' : 'none',
                        flexShrink: 0
                      }}>
                        {member.avatarUrl ? (
                          <img 
                            src={member.avatarUrl} 
                            alt={member.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                        ) : (
                          <span style={{
                            color: 'white',
                            fontWeight: '700',
                            fontSize: '1.2rem'
                          }}>
                            {member.role === 'parent' ? 'P' : 'C'}
                          </span>
                        )}
                      </div>

                      <div style={{flex: 1}}>
                        <h4 style={{
                          margin: 0,
                          fontSize: '1rem',
                          color: '#333',
                          fontWeight: '600'
                        }}>
                          {member.name}
                        </h4>
                        <p style={{
                          margin: '0.25rem 0 0 0',
                          fontSize: '0.85rem',
                          color: '#999'
                        }}>
                          {member.role === 'parent' ? '保護者' : '子供'}
                        </p>
                      </div>

                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: `2px solid ${isSelected ? '#667eea' : '#ddd'}`,
                        background: isSelected ? '#667eea' : 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                        flexShrink: 0
                      }}>
                        {isSelected && <Check size={16} style={{color: 'white'}} />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* フッター */}
      {step === 2 && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'white',
          padding: '1rem 1.25rem',
          borderTop: '1px solid #f0f0f0',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
          zIndex: 100
        }}>
          <div style={{
            display: 'flex',
            gap: '0.75rem'
          }}>
            <button
              onClick={() => setStep(1)}
              style={{
                flex: 1,
                padding: '1rem',
                background: 'white',
                color: '#667eea',
                border: '2px solid #667eea',
                borderRadius: '16px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem',
                transition: 'all 0.2s'
              }}
            >
              戻る
            </button>
            <button
              onClick={createGroup}
              disabled={loading || selectedMembers.length === 0}
              style={{
                flex: 2,
                padding: '1rem',
                background: loading || selectedMembers.length === 0
                  ? '#e9ecef'
                  : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: loading || selectedMembers.length === 0 ? '#999' : 'white',
                border: 'none',
                borderRadius: '16px',
                cursor: loading || selectedMembers.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: '700',
                fontSize: '1rem',
                boxShadow: loading || selectedMembers.length === 0 ? 'none' : '0 4px 12px rgba(102, 126, 234, 0.3)',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem'
              }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    border: '3px solid #f3f3f3',
                    borderTop: '3px solid #999',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  作成中...
                </>
              ) : (
                <>
                  <Check size={20} />
                  グループを作成
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// 3. グループチャット画面
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
        text: editingMessageText.trim(),
        edited: true,
        edited_at: new Date().toISOString()
      })
      .eq('id', editingMessageId);

    if (error) {
      console.error('Edit message error:', error);
      alert('メッセージの編集に失敗しました');
      return;
    }

    // データベース更新成功後、即座にローカル状態を更新
    setGroupMessages(prev => prev.map(m => 
      m.id === editingMessageId ? {
        ...m,
        text: editingMessageText.trim(),
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
              onClick={() => setShowGroupImageEdit(true)}
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
                cursor: 'pointer',
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
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    background: 'rgba(0,0,0,0.6)',
                    borderRadius: '50%',
                    padding: '0.25rem',
                    display: 'flex'
                  }}>
                    <i className="fas fa-camera" style={{fontSize: '0.6rem', color: 'white'}}></i>
                  </div>
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
                    
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      maxWidth: '65%',
                      width: 'auto',
                      position: 'relative'
                    }}>
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

      {/* メンバー一覧モーダル */}
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

            <div style={{padding: '1.5rem'}}>
              <div style={{
                background: '#f8f9fa',
                borderRadius: '12px',
                padding: '1rem',
                display: 'flex',
                justifyContent: 'space-around',
                marginBottom: '1rem'
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
              
              <button
                onClick={() => {
                  setShowMemberProfile(false);
                  setShowMembersModal(true);
                }}
                style={{
                  width: '100%',
                  padding: '0.875rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                戻る
              </button>
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

const ParentChatDirectScreen = () => {
  const [newMessage, setNewMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [chatTarget, setChatTarget] = useState(null);
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const chatBottomRef = useRef(null);

  const emojis = ['😀','😂','🥰','😍','🤔','😅','😊','👍','❤️','🎉',
                  '🔥','✨','💯','👏','🙏','😭','😱','🤗','😎','🥳'];

  useEffect(() => {
    const stored = sessionStorage.getItem('parentChatTarget');
    if (stored) {
      const target = JSON.parse(stored);
      setChatTarget(target);
      loadHistory(target.id);
      return subscribeMessages(target.id);
    } else {
      setCurrentView('parent-dashboard');
    }
  }, []);

useEffect(() => {
  chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [chatMessages]);

// ★ メニューを外クリックで閉じる
useEffect(() => {
  const handleOutsideClick = (e) => {
    if (!e.target.closest('[data-message-menu]')) {
      setShowMessageMenu(null);
    }
  };
  document.addEventListener('mousedown', handleOutsideClick);
  return () => document.removeEventListener('mousedown', handleOutsideClick);
}, []);

  const loadHistory = async (targetUserId) => {
    if (!currentUser?.id) return;
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(from_user_id.eq.${currentUser.id},to_user_id.eq.${targetUserId}),` +
          `and(from_user_id.eq.${targetUserId},to_user_id.eq.${currentUser.id})`
        )
        .order('created_at', { ascending: true });

      if (data) {
        const unread = data.filter(m => m.to_user_id === currentUser.id && !m.read);
        if (unread.length > 0) {
          await supabase
            .from('messages')
            .update({ read: true })
            .in('id', unread.map(m => m.id));
        }
        setChatMessages(data.map(m => ({
          id: m.id, from: m.from_user_id, to: m.to_user_id,
          text: m.text, timestamp: new Date(m.created_at),
          read: m.to_user_id === currentUser.id ? true : m.read,
          edited: m.edited || false,
          editedAt: m.edited_at ? new Date(m.edited_at) : null,
        })));
      }
    } catch (e) { console.error('loadHistory error:', e); }
  };

  const subscribeMessages = (targetUserId) => {
    const ch = supabase
      .channel('parent-chat-direct-' + targetUserId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `to_user_id=eq.${currentUser.id}`,
      }, async (payload) => {
        if (payload.new.from_user_id !== targetUserId) return;
        await supabase.from('messages').update({ read: true }).eq('id', payload.new.id);
        setChatMessages(prev =>
          prev.some(m => m.id === payload.new.id) ? prev : [...prev, {
            id: payload.new.id, from: payload.new.from_user_id,
            to: payload.new.to_user_id, text: payload.new.text,
            timestamp: new Date(payload.new.created_at), read: true,
            edited: false, editedAt: null,
          }]
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `from_user_id=eq.${currentUser.id}`,
      }, (payload) => {
        if (payload.new.to_user_id !== targetUserId) return;
        setChatMessages(prev =>
          prev.map(m => m.id === payload.new.id ? {
            ...m,
            read: payload.new.read,
            text: payload.new.text,
            edited: payload.new.edited || false,
            editedAt: payload.new.edited_at ? new Date(payload.new.edited_at) : null,
          } : m)
        );
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
      }, (payload) => {
        setChatMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  };

  const sendMsg = async () => {
    if (!newMessage.trim() || !chatTarget) return;
    const text = newMessage.trim();
    const tempId = 'temp-' + Date.now();
    setChatMessages(prev => [...prev, {
      id: tempId, from: currentUser.id, to: chatTarget.id,
      text, timestamp: new Date(), read: false, edited: false, editedAt: null,
    }]);
    setNewMessage('');
    setShowEmojiPicker(false);
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([{ from_user_id: currentUser.id, to_user_id: chatTarget.id, text, read: false }])
        .select().single();
      if (error) throw error;
      if (data) {
        setChatMessages(prev => prev.map(m =>
          m.id === tempId ? {
            id: data.id, from: data.from_user_id, to: data.to_user_id,
            text: data.text, timestamp: new Date(data.created_at), read: data.read,
            edited: false, editedAt: null,
          } : m
        ));
        setMessages(prev =>
          prev.some(m => m.id === data.id) ? prev : [...prev, {
            id: data.id, from: data.from_user_id, to: data.to_user_id,
            text: data.text, timestamp: new Date(data.created_at), read: data.read,
          }]
        );
      }
    } catch (e) {
      console.error('sendMsg error:', e);
      setChatMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(text);
      alert('送信に失敗しました');
    }
  };

  const deleteMessage = async (messageId) => {
    setChatMessages(prev => prev.filter(m => m.id !== messageId));
    try {
      const { error } = await supabase.from('messages').delete().eq('id', messageId);
      if (error) throw error;
    } catch (e) {
      console.error('deleteMessage error:', e);
      alert('削除に失敗しました');
      loadHistory(chatTarget.id);
    }
  };

  const startEdit = (msg) => {
    setEditingMessageId(msg.id);
    setEditingMessageText(msg.text);
    setShowMessageMenu(null);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
  };

const saveEdit = async () => {
  if (!editingMessageText.trim() || !editingMessageId) return;
  const newText = editingMessageText.trim();
  
  // ローカル更新
  setChatMessages(prev => prev.map(m =>
    m.id === editingMessageId ? { ...m, text: newText, edited: true, editedAt: new Date() } : m
  ));
  setEditingMessageId(null);
  setEditingMessageText('');
  
  try {
    console.log('保存開始:', editingMessageId, newText); // ← 追加
    const { data, error } = await supabase
      .from('messages')
      .update({ text: newText, edited: true, edited_at: new Date().toISOString() })
      .eq('id', editingMessageId)
      .select(); // ← .select()を追加
    
    console.log('保存結果:', data, error); // ← 追加
    
    if (error) throw error;
  } catch (e) {
    console.error('保存失敗:', e);
    alert('編集に失敗しました');
    loadHistory(chatParent?.id || chatTarget?.id);
  }
};

  if (!chatTarget) return null;

  const statusLabel =
    chatTarget.status === 'safe' ? '安全' :
    chatTarget.status === 'warning' ? '道に迷ってる' : '緊急';
  const statusColor =
    chatTarget.status === 'safe' ? 'rgba(255,255,255,0.85)' :
    chatTarget.status === 'warning' ? '#fef3c7' : '#fee2e2';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', flexDirection: 'column',
      background: '#e5ddd5', zIndex: 100,
      fontFamily: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif",
    }}>

      {/* ヘッダー */}
      <div style={{
        background: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
        padding: '0.875rem 1rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}>
        <button
          onClick={() => { sessionStorage.removeItem('parentChatTarget'); setCurrentView('parent-dashboard'); }}
          style={{
            background: 'rgba(255,255,255,0.2)', border: 'none',
            borderRadius: '50%', width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'white', flexShrink: 0, fontSize: '1.1rem',
          }}
        >←</button>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: chatTarget.avatarUrl ? 'white' : 'rgba(255,255,255,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: '1.2rem',
          overflow: 'hidden', border: '2px solid rgba(255,255,255,0.5)',
        }}>
          {chatTarget.avatarUrl
            ? <img src={chatTarget.avatarUrl} alt={chatTarget.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (chatTarget.name?.charAt(0) || 'C')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ color: 'white', margin: 0, fontSize: '1rem', fontWeight: 700 }}>{chatTarget.name}</h3>
          <p style={{ color: statusColor, margin: 0, fontSize: '0.76rem', fontWeight: 600 }}>{statusLabel}</p>
        </div>
      </div>

      {/* メッセージエリア */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '1rem',
        display: 'flex', flexDirection: 'column', gap: '0.625rem',
      }}>
        {chatMessages.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#999', gap: '0.75rem',
          }}>
            <MessageCircle size={48} style={{ opacity: 0.35 }} />
            <p style={{ margin: 0 }}>まだメッセージがありません</p>
          </div>
        ) : (
          chatMessages.map(msg => {
            const isMine = msg.from === currentUser.id;
            const isEditing = editingMessageId === msg.id;
            return (
              <div key={msg.id} style={{
                display: 'flex',
                flexDirection: isMine ? 'row-reverse' : 'row',
                alignItems: 'flex-end', gap: '0.5rem',
              }}>
                {/* 相手アバター */}
                {!isMine && (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    background: chatTarget.avatarUrl ? 'white' : 'linear-gradient(135deg,#667eea,#764ba2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700, fontSize: '0.8rem', overflow: 'hidden',
                    border: chatTarget.avatarUrl ? '2px solid #ddd' : 'none',
                  }}>
                    {chatTarget.avatarUrl
                      ? <img src={chatTarget.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (chatTarget.name?.charAt(0) || 'C')}
                  </div>
                )}

                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isMine ? 'flex-end' : 'flex-start',
                  maxWidth: '72%', position: 'relative',
                }}>
                  {/* 編集モード */}
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', minWidth: 200 }}>
                      <input
                        type="text"
                        value={editingMessageText}
                        onChange={e => setEditingMessageText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        style={{
                          padding: '0.6rem 0.875rem', borderRadius: 18,
                          border: '2px solid #667eea', fontSize: '0.95rem',
                          outline: 'none', background: 'white',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button onClick={cancelEdit} style={{
                          padding: '0.3rem 0.75rem', borderRadius: 12, border: 'none',
                          background: '#e0e0e0', color: '#555', fontSize: '0.8rem',
                          cursor: 'pointer', fontWeight: 600,
                        }}>キャンセル</button>
                        <button onClick={saveEdit} style={{
                          padding: '0.3rem 0.75rem', borderRadius: 12, border: 'none',
                          background: '#667eea', color: 'white', fontSize: '0.8rem',
                          cursor: 'pointer', fontWeight: 600,
                        }}>保存</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* バブル */}
                      <div
                        data-message-menu="true"
                        onClick={e => {
                          if (!isMine) return;
                          e.stopPropagation();
                          setShowMessageMenu(showMessageMenu === msg.id ? null : msg.id);
                        }}
                        style={{
                          padding: '0.6rem 0.875rem', wordBreak: 'break-word',
                          borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          background: isMine ? '#dcf8c6' : 'white',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          cursor: isMine ? 'pointer' : 'default',
                        }}
                      >
                        <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.4, color: '#111' }}>{msg.text}</p>
                      </div>

                      {/* 時刻・既読・編集済み */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                        marginTop: '0.15rem', padding: '0 0.2rem',
                      }}>
                        <small style={{ fontSize: '0.64rem', color: '#888' }}>
                          {msg.timestamp.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                          {msg.edited && ' · 編集済み'}
                        </small>
                        {isMine && (
                          <small style={{ fontSize: '0.64rem', fontWeight: 600, color: msg.read ? '#4fc3f7' : '#aaa' }}>
                            {msg.read ? '既読' : '未読'}
                          </small>
                        )}
                      </div>

                      {/* メッセージメニュー */}
                      {isMine && showMessageMenu === msg.id && (
                        <div
                          data-message-menu="true"
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: '100%', right: 0,
                            marginBottom: '0.25rem', background: 'white',
                            borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                            overflow: 'hidden', zIndex: 1000, minWidth: 110,
                          }}
                        >
                          <button
                            data-message-menu="true"
                            onClick={() => startEdit(msg)}
                            style={{
                              width: '100%', padding: '0.65rem 1rem',
                              background: 'none', border: 'none',
                              textAlign: 'left', cursor: 'pointer',
                              fontSize: '0.9rem', color: '#333',
                              display: 'flex', alignItems: 'center', gap: '0.5rem',
                              borderBottom: '1px solid #f0f0f0',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <Edit size={15} />編集
                          </button>
                          <button
                            data-message-menu="true"
                            onClick={() => { setShowMessageMenu(null); deleteMessage(msg.id); }}
                            style={{
                              width: '100%', padding: '0.65rem 1rem',
                              background: 'none', border: 'none',
                              textAlign: 'left', cursor: 'pointer',
                              fontSize: '0.9rem', color: '#ef4444',
                              display: 'flex', alignItems: 'center', gap: '0.5rem',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <Trash2 size={15} />削除
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* 入力エリア */}
      <div style={{
        background: '#f0f0f0', borderTop: '1px solid #ddd',
        padding: '0.625rem 0.75rem', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        position: 'relative',
      }}>
        <button type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => setShowEmojiPicker(p => !p)}
          style={{
            background: 'none', border: 'none', fontSize: '1.4rem',
            cursor: 'pointer', padding: '0.4rem', flexShrink: 0,
            display: 'flex', alignItems: 'center', lineHeight: 1,
          }}
        >😊</button>

        {showEmojiPicker && (
          <div style={{
            position: 'absolute', bottom: 60, left: 8,
            background: 'white', border: '1px solid #e0e0e0',
            borderRadius: 12, padding: '0.625rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            display: 'grid', gridTemplateColumns: 'repeat(6,1fr)',
            gap: 4, zIndex: 10, maxWidth: 290,
          }}>
            {emojis.map((em, i) => (
              <button key={i} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setNewMessage(p => p + em)}
                style={{
                  background: 'none', border: 'none', fontSize: '1.4rem',
                  cursor: 'pointer', padding: 3, borderRadius: 4, lineHeight: 1,
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f0f0'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >{em}</button>
            ))}
          </div>
        )}

        <input
          type="text" value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
          placeholder="メッセージを入力..."
          style={{
            flex: 1, padding: '0.7rem 1rem',
            border: '1px solid #ccc', borderRadius: 24,
            fontSize: '0.95rem', outline: 'none',
            background: 'white', minWidth: 0,
          }}
        />

        <button type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={sendMsg}
          style={{
            width: 44, height: 44, borderRadius: '50%', border: 'none',
            background: newMessage.trim() ? 'linear-gradient(135deg,#667eea,#764ba2)' : '#ccc',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: newMessage.trim() ? 'pointer' : 'default',
            color: 'white', flexShrink: 0, transition: 'background 0.15s',
          }}
        ><Send size={20} /></button>
      </div>
    </div>
  );
};

useEffect(() => {
  const handleError = (event) => {
    alert('エラー: ' + event.message + '\n場所: ' + event.filename + ':' + event.lineno);
  };
  window.addEventListener('error', handleError);
  return () => window.removeEventListener('error', handleError);
}, []);

// 保護者ダッシュボード
  const ParentDashboard = () => {
    const [selectedMemberId, setSelectedMemberId] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [activeTab, setActiveTab] = useState('map');
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showMemberManagement, setShowMemberManagement] = useState(false);
    const [showAlertConfirm, setShowAlertConfirm] = useState(false);
    const [selectedAlert, setSelectedAlert] = useState(null);
    const [scheduleForm, setScheduleForm] = useState({
      title: '',
      time: '',
      type: 'departure',
      location: ''
    });

    const openParentChat = (member) => {
    if (!member) return;
    sessionStorage.setItem('parentChatTarget', JSON.stringify({
      id: member.userId,
      name: member.name,
      avatarUrl: member.avatarUrl || null,
      status: member.status,
    }));
    setCurrentView('parent-chat-direct');
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

    // Leaflet Map useEffect
useEffect(() => {
  if (activeTab !== 'map' || !displayMember) {
    return;
  }

  // Leafletの読み込みを待つ
  let retryCount = 0;
  const maxRetry = 20;
  
  const initMap = () => {
    try {
      if (typeof window.L === 'undefined') {
        retryCount++;
        if (retryCount < maxRetry) {
          setTimeout(initMap, 300);
        }
        return;
      }

      const mapContainer = document.getElementById('map');
      if (!mapContainer) {
        retryCount++;
        if (retryCount < maxRetry) {
          setTimeout(initMap, 300);
        }
        return;
      }

      mapContainer.innerHTML = '';

      const map = window.L.map('map').setView(
        [displayMember.location.lat, displayMember.location.lng],
        15
      );

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      const avatarContent = displayMember.avatarUrl
        ? `<img src="${displayMember.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />`
        : `<span style="color: #667eea; font-weight: 700; font-size: 20px;">${displayMember.avatar}</span>`;

      const customIcon = window.L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="position: relative; width: 60px; height: 80px; transform: translateX(-50%);">
            <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 50px; height: 50px; background: white; border: 3px solid #667eea; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; overflow: hidden; z-index: 2;">
              ${avatarContent}
            </div>
            <div style="position: absolute; top: 50px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 24px solid #667eea; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); z-index: 1;"></div>
          </div>
        `,
        iconSize: [60, 74],
        iconAnchor: [30, 74]
      });

      const marker = window.L.marker(
        [displayMember.location.lat, displayMember.location.lng],
        { icon: customIcon }
      ).addTo(map);

      marker.bindPopup(`
        <div style="text-align: center; padding: 0.75rem; min-width: 200px;">
          <strong style="font-size: 1.2rem; color: #333;">${displayMember.name}</strong><br/>
          <span style="color: #999; font-size: 0.85rem; margin-top: 0.25rem; display: block;">
            ${displayMember.lastUpdate.toLocaleString('ja-JP', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}
          </span>
          <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #e9ecef; text-align: left;">
            <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.5rem;"><strong>状態:</strong> ${displayMember.status === 'safe' ? '安全' : displayMember.status === 'warning' ? '道に迷ってる' : '緊急'}</div>
            <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.5rem;"><strong>位置:</strong> ${displayMember.location.address}</div>
            <div style="font-size: 0.9rem; color: #666;"><strong>バッテリー:</strong> ${displayMember.battery}%</div>
          </div>
        </div>
      `);

      // クリーンアップ用にmapを返す
      mapContainer._leafletMap = map;

    } catch (error) {
      console.error('Map initialization error:', error);
      // エラーが起きても画面はクラッシュさせない
    }
  };

  initMap();

  return () => {
    try {
      const mapContainer = document.getElementById('map');
      if (mapContainer && mapContainer._leafletMap) {
        mapContainer._leafletMap.remove();
        mapContainer._leafletMap = null;
      }
    } catch (e) {
      console.error('Map cleanup error:', e);
    }
  };
}, [activeTab, displayMember?.location.lat, displayMember?.location.lng]);

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
          <div className="loading-screen">
            <div className="loading-content">
              <div className="spinner"></div>
              <p className="loading-text">データを読み込んでいます...</p>
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
            <button className="icon-btn" onClick={() => setCurrentView('group-list')} title="グループチャット">
              <Users size={20} />
            </button>
            {displayMember && (
              <button 
                className="icon-btn" 
                onClick={() => openParentChat(displayMember)}
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
                <div 
                  key={member.id} 
                  className={`member-card ${selectedMemberId === member.id ? 'active' : ''}`} 
                  onClick={() => setSelectedMemberId(member.id)}
                >
                  <div className="member-avatar">
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt={member.name} />
                    ) : (
                      member.avatar
                    )}
                  </div>
                  <div className="member-info">
                    <h3>{member.name}</h3>
                    <div className="member-status">
                      <span className={`status-dot ${member.status}`}></span>
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
                <button className="action-btn chat-btn" onClick={() => openParentChat(displayMember)}>
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
                  <button className={`tab ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
                    <MapPin size={18} />
                    位置情報
                  </button>
                  <button className={`tab ${activeTab === 'schedule' ? 'active' : ''}`} onClick={() => setActiveTab('schedule')}>
                    <Calendar size={18} />
                    スケジュール
                  </button>
                  <button className={`tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
                    <Activity size={18} />
                    活動履歴
                  </button>
                  <button className={`tab ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')}>
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
                        <div className="map-header-buttons">
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
                                    alert('状態の更新に失敗しました');
                                    return;
                                  }
                                  
                                  setMembers(prev => prev.map(m => 
                                    m.id === displayMember.id ? { ...m, status: 'safe' } : m
                                  ));
                                  
                                  alert('状態を「安全」に戻しました');
                                } catch (error) {
                                  alert('状態の更新に失敗しました');
                                }
                              }}
                              style={{background: '#10b981', color: '#fff'}}
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
                            className={`gps-btn ${displayMember.gpsActive ? 'active' : ''}`}
                            onClick={() => displayMember.gpsActive ? stopGPSTracking(displayMember.id) : startGPSTracking(displayMember.id)}
                          >
                            <Navigation size={16} />
                            {displayMember.gpsActive ? 'GPS停止' : 'GPS開始'}
                          </button>
                        </div>
                      </div>

                      <div className="map-wrapper">
                        <div id="map" className="map-element"></div>
                        {displayMember.gpsActive && (
                          <div className="gps-tracking-indicator">
                            <div className="gps-pulse-dot"></div>
                            GPS追跡中
                          </div>
                        )}
                      </div>

                      <div className="map-info-panel">
                        <div className="map-info-box">
                          <div className="map-info-box-header">
                            <MapPin size={16} style={{color: '#667eea'}} />
                            <span>座標</span>
                          </div>
                          <div className="map-info-box-content">
                            {displayMember.location.lat.toFixed(6)}°N<br/>
                            {displayMember.location.lng.toFixed(6)}°E
                          </div>
                        </div>

                        <div className="map-info-box">
                          <div className="map-info-box-header">
                            <Clock size={16} style={{color: '#667eea'}} />
                            <span>最終更新</span>
                          </div>
                          <div className="map-info-box-content">
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
                        className="map-google-link"
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
                              <div className="schedule-time-badge">
                                {item.time.substring(0, 5)}
                              </div>
                              
                              <div className="schedule-content">
                                <div className="schedule-title-row">
                                  <h4>{item.title}</h4>
                                  <span className={`schedule-type-badge ${item.type}`}>
                                    {item.type === 'departure' ? '出発' : '到着'}
                                  </span>
                                </div>
                                <p className="schedule-location">
                                  <MapPin size={14} />
                                  {item.location}
                                </p>
                              </div>

                              <div className="schedule-actions">
                                {item.completed ? (
                                  <div className="schedule-completed">
                                    <Check size={20} />
                                  </div>
                                ) : (
                                  <div className="schedule-pending">
                                    <Clock size={20} />
                                  </div>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setScheduleForm({
                                      id: item.id,
                                      title: item.title,
                                      time: item.time,
                                      type: item.type,
                                      location: item.location
                                    });
                                    setShowScheduleModal(true);
                                  }}
                                  className="schedule-edit-btn"
                                  title="編集"
                                >
                                  <i className="fas fa-edit"></i>
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!confirm('このスケジュールを削除しますか？')) return;
                                    try {
                                      const { error } = await supabase
                                        .from('schedules')
                                        .delete()
                                        .eq('id', item.id);
                                      
                                      if (error) {
                                        alert('削除に失敗しました');
                                        return;
                                      }
                                      
                                      await loadSchedules(displayMember.id);
                                      alert('スケジュールを削除しました');
                                    } catch (error) {
                                      alert('削除に失敗しました');
                                    }
                                  }}
                                  className="schedule-delete-btn"
                                  title="削除"
                                >
                                  <X size={18} />
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="schedule-empty">
                            <Calendar size={48} />
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
                              <div className="activity-icon-wrapper">
                                <div className="activity-icon">
                                  <MapPin size={20} />
                                </div>
                                {index < displayMember.locationHistory.length - 1 && (
                                  <div className="activity-line"></div>
                                )}
                              </div>
                              <div className="activity-details">
                                <p className="activity-location">{activity.address || '位置情報'}</p>
                                <div className="activity-coords">
                                  <span>緯度: {activity.lat?.toFixed(4)}</span>
                                  <span>•</span>
                                  <span>経度: {activity.lng?.toFixed(4)}</span>
                                </div>
                                <small className="activity-time">
                                  <Clock size={14} />
                                  {new Date(activity.timestamp).toLocaleString('ja-JP', {
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </small>
                              </div>
                              <button
                                onClick={() => {
                                  window.open(`https://www.google.com/maps?q=${activity.lat},${activity.lng}`, '_blank');
                                }}
                                className="activity-map-btn"
                                title="地図で見る"
                              >
                                <MapPin size={16} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="activity-empty">
                            <Activity size={48} />
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
                          {alerts.map(alert => {
                            const member = members.find(m => m.id === alert.memberId);
                            return (
                              <div key={alert.id} className={`alert-item-new ${alert.type}`}>
                                <div className="alert-icon-new">
                                  {alert.type === 'arrival' ? <Check size={24} /> : 
                                   alert.type === 'sos' ? <AlertTriangle size={24} /> :
                                   alert.type === 'lost' ? <Navigation size={24} /> :
                                   <Bell size={24} />}
                                </div>
                                <div className="alert-content-new">
                                  <div className="alert-header-new">
                                    <span className={`alert-badge ${alert.type}`}>
                                      {alert.type === 'sos' ? 'SOS' : 
                                       alert.type === 'lost' ? '道に迷った' :
                                       alert.type === 'arrival' ? '到着' :
                                       alert.type === 'battery' ? 'バッテリー' : 'アラート'}
                                    </span>
                                    {!alert.read && (
                                      <span className="alert-unread-dot"></span>
                                    )}
                                  </div>
                                  <p className="alert-message">{alert.message}</p>
                                  <small className="alert-time">
                                    <Clock size={14} />
                                    {alert.timestamp.toLocaleString('ja-JP', {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </small>
                                </div>
                                <div className="alert-actions-new">
                                  {!alert.read && (
                                    <button 
                                      className="alert-read-btn"
                                      onClick={() => {
                                        setSelectedAlert(alert);
                                        setShowAlertConfirm(true);
                                      }}
                                      title="解決済みにする"
                                    >
                                      <Check size={18} />
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
                                          alert('削除に失敗しました');
                                          return;
                                        }
                                        
                                        setAlerts(prev => prev.filter(a => a.id !== alert.id));
                                      } catch (error) {
                                        alert('削除に失敗しました');
                                      }
                                    }}
                                    className="alert-delete-btn-new"
                                    title="削除"
                                  >
                                    <X size={18} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
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

       {/* スケジュールモーダル */}
        {showScheduleModal && (
          <div className="chat-modal">
            <div className="chat-container" style={{maxWidth: '500px', maxHeight: '90vh'}}>
              <div className="chat-header" style={{background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}}>
                <h3>{scheduleForm.id ? 'スケジュールを編集' : 'スケジュールを追加'}</h3>
                <button 
                  className="close-btn"
                  onClick={() => {
                    setShowScheduleModal(false);
                    setScheduleForm({
                      title: '',
                      time: '',
                      type: 'departure',
                      location: ''
                    });
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{padding: '1.5rem', overflowY: 'auto', flex: 1}}>
                <div className="schedule-modal-form">
                  <div className="schedule-form-group">
                    <label>
                      <Calendar size={18} />
                      タイトル
                    </label>
                    <input
                      type="text"
                      value={scheduleForm.title}
                      onChange={(e) => setScheduleForm({...scheduleForm, title: e.target.value})}
                      placeholder="例: 学校へ登校"
                      className="schedule-form-input"
                    />
                  </div>

                  <div className="schedule-form-group">
                    <label>
                      <Clock size={18} />
                      時間
                    </label>
                    <input
                      type="time"
                      value={scheduleForm.time}
                      onChange={(e) => setScheduleForm({...scheduleForm, time: e.target.value})}
                      className="schedule-form-input"
                    />
                  </div>

                  <div className="schedule-form-group">
                    <label>
                      <Navigation size={18} />
                      種別
                    </label>
                    <div className="schedule-type-selector">
                      <button
                        type="button"
                        className={`schedule-type-option ${scheduleForm.type === 'departure' ? 'active' : ''}`}
                        onClick={() => setScheduleForm({...scheduleForm, type: 'departure'})}
                      >
                        <div className="schedule-type-icon departure">
                          <i className="fas fa-arrow-right"></i>
                        </div>
                        <span>出発</span>
                      </button>
                      <button
                        type="button"
                        className={`schedule-type-option ${scheduleForm.type === 'arrival' ? 'active' : ''}`}
                        onClick={() => setScheduleForm({...scheduleForm, type: 'arrival'})}
                      >
                        <div className="schedule-type-icon arrival">
                          <i className="fas fa-flag-checkered"></i>
                        </div>
                        <span>到着</span>
                      </button>
                    </div>
                  </div>

                  <div className="schedule-form-group">
                    <label>
                      <MapPin size={18} />
                      場所
                    </label>
                    <input
                      type="text"
                      value={scheduleForm.location}
                      onChange={(e) => setScheduleForm({...scheduleForm, location: e.target.value})}
                      placeholder="例: 東京第一小学校"
                      className="schedule-form-input"
                    />
                  </div>

                  <button 
                    onClick={async () => {
                      const displayMemberCurrent = members.find(m => m.id === selectedMemberId) || members[0];
                      if (!scheduleForm.title || !scheduleForm.time || !displayMemberCurrent) {
                        alert('タイトルと時間を入力してください');
                        return;
                      }

                      try {
                        if (scheduleForm.id) {
                          // 編集
                          const { error } = await supabase
                            .from('schedules')
                            .update({
                              title: scheduleForm.title,
                              time: scheduleForm.time,
                              type: scheduleForm.type,
                              location: scheduleForm.location
                            })
                            .eq('id', scheduleForm.id);

                          if (error) {
                            alert('スケジュールの更新に失敗しました');
                            return;
                          }

                          alert('スケジュールを更新しました！');
                        } else {
                          // 新規追加
                          const { error } = await supabase
                            .from('schedules')
                            .insert([{
                              member_id: displayMemberCurrent.id,
                              title: scheduleForm.title,
                              time: scheduleForm.time,
                              type: scheduleForm.type,
                              location: scheduleForm.location,
                              date: new Date().toISOString().split('T')[0],
                              completed: false
                            }]);

                          if (error) {
                            alert('スケジュールの追加に失敗しました');
                            return;
                          }

                          alert('スケジュールを追加しました！');
                        }

                        await loadSchedules(displayMemberCurrent.id);
                        
                        setScheduleForm({
                          title: '',
                          time: '',
                          type: 'departure',
                          location: ''
                        });
                        setShowScheduleModal(false);
                      } catch (error) {
                        alert('スケジュールの保存に失敗しました');
                      }
                    }}
                    className="schedule-submit-btn"
                  >
                    <Plus size={20} />
                    {scheduleForm.id ? '更新' : '追加'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* アラート解決確認モーダル */}
        {showAlertConfirm && selectedAlert && (
          <div className="emergency-modal">
            <div className="emergency-dialog-new">
              <div className={`emergency-icon-new ${selectedAlert.type === 'sos' ? 'danger' : selectedAlert.type === 'lost' ? 'warning' : 'info'}`}>
                {selectedAlert.type === 'sos' ? <AlertTriangle size={64} /> : 
                 selectedAlert.type === 'lost' ? <Navigation size={64} /> :
                 <Check size={64} />}
              </div>
              <h2>
                {selectedAlert.type === 'sos' ? '緊急事態は解決しましたか？' :
                 selectedAlert.type === 'lost' ? '無事に目的地に到着しましたか？' :
                 selectedAlert.type === 'battery' ? 'バッテリーの問題は解決しましたか？' :
                 'このアラートを解決済みにしますか？'}
              </h2>
              {(selectedAlert.type === 'sos' || selectedAlert.type === 'lost') && (
                <p>状態を「安全」に戻します。</p>
              )}
              <p className="emergency-subtext">
                {selectedAlert.type === 'sos' ? 'メンバーが安全な状態になったことを確認してください。' :
                 selectedAlert.type === 'lost' ? 'メンバーが無事に到着したことを確認してください。' :
                 'この操作は取り消せません。'}
              </p>
              <div className="emergency-actions-new">
                <button 
                  className="emergency-cancel-btn" 
                  onClick={() => {
                    setShowAlertConfirm(false);
                    setSelectedAlert(null);
                  }}
                >
                  キャンセル
                </button>
                <button 
                    className={`emergency-confirm-btn ${
                    selectedAlert.type === 'sos' ? 'danger' : 
                    selectedAlert.type === 'lost' ? 'success' : 
                    'primary'
                  }`}
                  onClick={async () => {
                    try {
                      console.log('[ALERT] Processing alert:', selectedAlert.id, 'Type:', selectedAlert.type);
                      
                      const { error: alertError } = await supabase
                        .from('alerts')
                        .update({ read: true })
                        .eq('id', selectedAlert.id);
                      
                      if (alertError) {
                        console.error('[ALERT] Update alert error:', alertError);
                        alert('アラートの更新に失敗しました: ' + alertError.message);
                        return;
                      }
                      
                      setAlerts(prev => prev.map(a => 
                        a.id === selectedAlert.id ? {...a, read: true} : a
                      ));
                      
                      console.log('[ALERT] Alert marked as read');

                      if (selectedAlert.type === 'sos' || selectedAlert.type === 'lost') {
                        console.log('[ALERT] Updating member status to safe for member:', selectedAlert.memberId);
                        
                        const { error: memberError } = await supabase
                          .from('members')
                          .update({ status: 'safe' })
                          .eq('id', selectedAlert.memberId);
                        
                        if (memberError) {
                          console.error('[ALERT] Update member error:', memberError);
                          alert('状態の更新に失敗しました: ' + memberError.message);
                          return;
                        }
                        
                        console.log('[ALERT] Member status updated to safe');
                        
                        setMembers(prev => prev.map(m => 
                          m.id === selectedAlert.memberId ? { ...m, status: 'safe' } : m
                        ));
                        
                        console.log('[ALERT] Local state updated');
                      }
                      
                      setShowAlertConfirm(false);
                      setSelectedAlert(null);
                    } catch (error) {
                      console.error('[ALERT] Unexpected error:', error);
                      alert('処理に失敗しました: ' + error.message);
                    }
                  }}
                >
                  {selectedAlert.type === 'sos' || selectedAlert.type === 'lost' ? '安全に戻す' : '解決済みにする'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* メンバー管理モーダル */}
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
                {myChildren.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '3rem', color: '#999'}}>
                    <Users size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
                    <p>登録されている子供はいません</p>
                  </div>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    {myChildren.map(member => (
                      <div key={member.id} className="parent-info-card">
                        <div className="parent-avatar">
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt={member.name} />
                          ) : (
                            member.avatar
                          )}
                        </div>
                        <div className="parent-info">
                          <h4 className="parent-name">{member.name}</h4>
                          <p className="parent-email">
                            バッテリー: {member.battery}% | 
                            状態: {member.status === 'safe' ? '安全' : member.status === 'warning' ? '道に迷ってる' : '緊急'}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            if (!confirm(`${member.name}を削除しますか？`)) return;
                            
                            try {
                              const { error } = await supabase
                                .from('parent_children')
                                .delete()
                                .eq('parent_id', currentUser.id)
                                .eq('child_id', member.userId);
                              
                              if (error) {
                                alert('削除に失敗しました');
                                return;
                              }
                              
                              await loadMembersData(currentUser);
                              alert('メンバーを削除しました');
                              setShowMemberManagement(false);
                            } catch (error) {
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
                            fontSize: '0.9rem'
                          }}
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

const ParentChatScreen = () => {
  const [newMessage, setNewMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [chatParent, setChatParent] = useState(null);
  const [showMessageMenu, setShowMessageMenu] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const chatBottomRef = useRef(null);
  const emojis = ['😀','😂','🥰','😍','🤔','😅','😊','👍','❤️','🎉','🔥','✨','💯','👏','🙏','😭','😱','🤗','😎','🥳'];

  useEffect(() => {
    const stored = sessionStorage.getItem('chatParent');
    if (stored) {
      const parent = JSON.parse(stored);
      setChatParent(parent);
      loadHistory(parent.id);
      return subscribeMessages(parent.id);
    } else {
      setCurrentView('child-dashboard');
    }
  }, []);

useEffect(() => {
  chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [chatMessages]);

// ★ メニューを外クリックで閉じる
useEffect(() => {
  const handleOutsideClick = (e) => {
    if (!e.target.closest('[data-message-menu]')) {
      setShowMessageMenu(null);
    }
  };
  document.addEventListener('mousedown', handleOutsideClick);
  return () => document.removeEventListener('mousedown', handleOutsideClick);
}, []);

  const loadHistory = async (parentId) => {
    if (!currentUser?.id) return;
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(from_user_id.eq.${currentUser.id},to_user_id.eq.${parentId}),` +
          `and(from_user_id.eq.${parentId},to_user_id.eq.${currentUser.id})`
        )
        .order('created_at', { ascending: true });
      if (data) {
        const unread = data.filter(m => m.to_user_id === currentUser.id && !m.read);
        if (unread.length > 0) {
          await supabase.from('messages').update({ read: true }).in('id', unread.map(m => m.id));
        }
        setChatMessages(data.map(m => ({
          id: m.id, from: m.from_user_id, to: m.to_user_id,
          text: m.text, timestamp: new Date(m.created_at),
          read: m.to_user_id === currentUser.id ? true : m.read,
          edited: m.edited || false,
          editedAt: m.edited_at ? new Date(m.edited_at) : null,
        })));
      }
    } catch (e) { console.error(e); }
  };

  const subscribeMessages = (parentId) => {
    const ch = supabase
      .channel('parent-chat-' + parentId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `to_user_id=eq.${currentUser.id}`
      }, async (payload) => {
        if (payload.new.from_user_id !== parentId) return;
        await supabase.from('messages').update({ read: true }).eq('id', payload.new.id);
        setChatMessages(prev =>
          prev.some(m => m.id === payload.new.id) ? prev : [...prev, {
            id: payload.new.id, from: payload.new.from_user_id,
            to: payload.new.to_user_id, text: payload.new.text,
            timestamp: new Date(payload.new.created_at), read: true,
            edited: false, editedAt: null,
          }]
        );
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `from_user_id=eq.${currentUser.id}`,
      }, (payload) => {
        if (payload.new.to_user_id !== parentId) return;
        setChatMessages(prev =>
          prev.map(m => m.id === payload.new.id ? {
            ...m,
            text: payload.new.text,
            edited: payload.new.edited || false,
            editedAt: payload.new.edited_at ? new Date(payload.new.edited_at) : null,
          } : m)
        );
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
      }, (payload) => {
        setChatMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  };

  const sendMsg = async () => {
    if (!newMessage.trim() || !chatParent) return;
    const text = newMessage.trim();
    const tempId = 'temp-' + Date.now();
    setChatMessages(prev => [...prev, {
      id: tempId, from: currentUser.id, to: chatParent.id,
      text, timestamp: new Date(), read: false, edited: false, editedAt: null,
    }]);
    setNewMessage('');
    setShowEmojiPicker(false);
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([{ from_user_id: currentUser.id, to_user_id: chatParent.id, text, read: false }])
        .select().single();
      if (error) throw error;
      if (data) {
        setChatMessages(prev => prev.map(m =>
          m.id === tempId ? {
            id: data.id, from: data.from_user_id, to: data.to_user_id,
            text: data.text, timestamp: new Date(data.created_at), read: data.read,
            edited: false, editedAt: null,
          } : m
        ));
      }
    } catch (e) {
      setChatMessages(prev => prev.filter(m => m.id !== tempId));
      setNewMessage(text);
      alert('送信に失敗しました');
    }
  };

  const deleteMessage = async (messageId) => {
    setChatMessages(prev => prev.filter(m => m.id !== messageId));
    try {
      const { error } = await supabase.from('messages').delete().eq('id', messageId);
      if (error) throw error;
    } catch (e) {
      alert('削除に失敗しました');
      loadHistory(chatParent.id);
    }
  };

  const startEdit = (msg) => {
    setEditingMessageId(msg.id);
    setEditingMessageText(msg.text);
    setShowMessageMenu(null);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
  };

const saveEdit = async () => {
  if (!editingMessageText.trim() || !editingMessageId) return;
  const newText = editingMessageText.trim();
  
  // ローカル更新
  setChatMessages(prev => prev.map(m =>
    m.id === editingMessageId ? { ...m, text: newText, edited: true, editedAt: new Date() } : m
  ));
  setEditingMessageId(null);
  setEditingMessageText('');
  
  try {
    console.log('保存開始:', editingMessageId, newText); // ← 追加
    const { data, error } = await supabase
      .from('messages')
      .update({ text: newText, edited: true, edited_at: new Date().toISOString() })
      .eq('id', editingMessageId)
      .select(); // ← .select()を追加
    
    console.log('保存結果:', data, error); // ← 追加
    
    if (error) throw error;
  } catch (e) {
    console.error('保存失敗:', e);
    alert('編集に失敗しました');
    loadHistory(chatParent?.id || chatTarget?.id);
  }
};

  const goBack = () => {
    const stored = sessionStorage.getItem('chatParentList');
    const list = stored ? JSON.parse(stored) : [];
    sessionStorage.removeItem('chatParent');
    setCurrentView(list.length > 1 ? 'parent-list' : 'child-dashboard');
  };

  if (!chatParent) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', flexDirection: 'column',
      background: '#e5ddd5', zIndex: 100
    }}>
      {/* ヘッダー */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '0.875rem 1rem', display: 'flex', alignItems: 'center',
        gap: '0.75rem', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}>
        <button onClick={goBack} style={{
          background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%',
          width: 40, height: 40, display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', color: 'white', flexShrink: 0, fontSize: '1.1rem'
        }}>←</button>
        <div style={{
          width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
          background: chatParent.avatar_url ? 'white' : 'rgba(255,255,255,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: '1.2rem',
          overflow: 'hidden', border: '2px solid rgba(255,255,255,0.5)'
        }}>
          {chatParent.avatar_url
            ? <img src={chatParent.avatar_url} alt={chatParent.name} style={{width:'100%',height:'100%',objectFit:'cover'}} />
            : 'P'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ color: 'white', margin: 0, fontSize: '1rem', fontWeight: 700 }}>{chatParent.name}</h3>
          <p style={{ color: 'rgba(255,255,255,0.8)', margin: 0, fontSize: '0.76rem' }}>保護者</p>
        </div>
      </div>

      {/* メッセージ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {chatMessages.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color:'#999', gap:'0.75rem' }}>
            <MessageCircle size={48} style={{ opacity: 0.35 }} />
            <p style={{ margin: 0 }}>まだメッセージがありません</p>
          </div>
        ) : chatMessages.map(msg => {
          const isMine = msg.from === currentUser.id;
          const isEditing = editingMessageId === msg.id;
          return (
            <div key={msg.id} style={{
              display: 'flex', flexDirection: isMine ? 'row-reverse' : 'row',
              alignItems: 'flex-end', gap: '0.5rem'
            }}>
              {!isMine && (
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: chatParent.avatar_url ? 'white' : 'linear-gradient(135deg,#667eea,#d97706)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontWeight: 700, fontSize: '0.8rem', overflow: 'hidden',
                  border: chatParent.avatar_url ? '2px solid #ddd' : 'none'
                }}>
                  {chatParent.avatar_url ? <img src={chatParent.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} /> : 'P'}
                </div>
              )}
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
                maxWidth: '72%', position: 'relative',
              }}>
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', minWidth: 200 }}>
                    <input
                      type="text" value={editingMessageText}
                      onChange={e => setEditingMessageText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                      style={{
                        padding: '0.6rem 0.875rem', borderRadius: 18,
                        border: '2px solid #667eea', fontSize: '0.95rem',
                        outline: 'none', background: 'white',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                      <button onClick={cancelEdit} style={{
                        padding: '0.3rem 0.75rem', borderRadius: 12, border: 'none',
                        background: '#e0e0e0', color: '#555', fontSize: '0.8rem',
                        cursor: 'pointer', fontWeight: 600,
                      }}>キャンセル</button>
                      <button onClick={saveEdit} style={{
                        padding: '0.3rem 0.75rem', borderRadius: 12, border: 'none',
                        background: '#667eea', color: 'white', fontSize: '0.8rem',
                        cursor: 'pointer', fontWeight: 600,
                      }}>保存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      data-message-menu="true"
                      onClick={e => {
                        if (!isMine) return;
                        e.stopPropagation();
                        setShowMessageMenu(showMessageMenu === msg.id ? null : msg.id);
                      }}
                      style={{
                        padding: '0.6rem 0.875rem', wordBreak: 'break-word',
                        borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        background: isMine ? '#dcf8c6' : 'white',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                        cursor: isMine ? 'pointer' : 'default',
                      }}
                    >
                      <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.4, color: '#111' }}>{msg.text}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem', padding: '0 0.2rem' }}>
                      <small style={{ fontSize: '0.64rem', color: '#888' }}>
                        {msg.timestamp.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        {msg.edited && ' · 編集済み'}
                      </small>
                      {isMine && (
                        <small style={{ fontSize: '0.64rem', color: msg.read ? '#4fc3f7' : '#aaa', fontWeight: 600 }}>
                          {msg.read ? '既読' : '未読'}
                        </small>
                      )}
                    </div>
                    {isMine && showMessageMenu === msg.id && (
                      <div
                        data-message-menu="true"
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: 'absolute', bottom: '100%', right: 0,
                          marginBottom: '0.25rem', background: 'white',
                          borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                          overflow: 'hidden', zIndex: 1000, minWidth: 110,
                        }}
                      >
<button
  data-message-menu="true"
  onMouseDown={e => e.preventDefault()}
  onClick={(e) => {
    e.stopPropagation();
    startEdit(msg);
  }}
  style={{
    width: '100%', padding: '0.65rem 1rem',
    background: 'none', border: 'none',
    textAlign: 'left', cursor: 'pointer',
    fontSize: '0.9rem', color: '#333',
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    borderBottom: '1px solid #f0f0f0',
  }}
  onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
  onMouseLeave={e => e.currentTarget.style.background = 'none'}
><Edit size={15} /> 編集</button>

<button
  data-message-menu="true"
  onMouseDown={e => e.preventDefault()}
  onClick={(e) => {
    e.stopPropagation();
    setShowMessageMenu(null);
    deleteMessage(msg.id);
  }}
  style={{
    width: '100%', padding: '0.65rem 1rem',
    background: 'none', border: 'none',
    textAlign: 'left', cursor: 'pointer',
    fontSize: '0.9rem', color: '#ef4444',
    display: 'flex', alignItems: 'center', gap: '0.5rem',
  }}
  onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
  onMouseLeave={e => e.currentTarget.style.background = 'none'}
><Trash2 size={15} /> 削除</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={chatBottomRef} />
      </div>

      {/* 入力エリア */}
      <div style={{
        background: '#f0f0f0', borderTop: '1px solid #ddd',
        padding: '0.625rem 0.75rem', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative'
      }}>
        <button type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => setShowEmojiPicker(p => !p)}
          style={{ background:'none', border:'none', fontSize:'1.4rem', cursor:'pointer', padding:'0.4rem', flexShrink:0, display:'flex', alignItems:'center', lineHeight:1 }}
        >😊</button>

        {showEmojiPicker && (
          <div style={{
            position:'absolute', bottom:'60px', left:'8px',
            background:'white', border:'1px solid #e0e0e0', borderRadius:'12px',
            padding:'0.625rem', boxShadow:'0 4px 16px rgba(0,0,0,0.15)',
            display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'4px', zIndex:10, maxWidth:'290px'
          }}>
            {emojis.map((em, i) => (
              <button key={i} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setNewMessage(p => p + em)}
                style={{ background:'none', border:'none', fontSize:'1.4rem', cursor:'pointer', padding:'3px', borderRadius:'4px', lineHeight:1 }}
                onMouseEnter={e => e.currentTarget.style.background='#f0f0f0'}
                onMouseLeave={e => e.currentTarget.style.background='none'}
              >{em}</button>
            ))}
          </div>
        )}

        <input type="text" value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
          placeholder="メッセージを入力..."
          style={{ flex:1, padding:'0.7rem 1rem', border:'1px solid #ccc', borderRadius:'24px', fontSize:'0.95rem', outline:'none', background:'white', minWidth:0 }}
        />

        <button type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={sendMsg}
          style={{
            width:44, height:44, borderRadius:'50%', border:'none',
            background: newMessage.trim() ? 'linear-gradient(135deg,#667eea,#764ba2)' : '#ccc',
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor: newMessage.trim() ? 'pointer' : 'default',
            color:'white', flexShrink:0, transition:'background 0.15s',
          }}
        ><Send size={20} /></button>
      </div>
    </div>
  );
  };

  // ===== 保護者選択画面（複数保護者の場合の独立ビュー） =====
  const ParentListScreen = () => {
    const [parents, setParents] = useState([]);

    useEffect(() => {
      const stored = sessionStorage.getItem('chatParentList');
      if (stored) setParents(JSON.parse(stored));
      else setCurrentView('child-dashboard');
    }, []);

    const openChat = (parent) => {
      sessionStorage.setItem('chatParent', JSON.stringify(parent));
      setCurrentView('parent-chat');
    };

    return (
      <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#667eea,#764ba2)',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'1.25rem',display:'flex',alignItems:'center',gap:'1rem'}}>
          <button onClick={() => setCurrentView('child-dashboard')} style={{
            background:'rgba(255,255,255,0.2)',border:'none',borderRadius:'50%',
            width:'40px',height:'40px',display:'flex',alignItems:'center',
            justifyContent:'center',cursor:'pointer',color:'white',fontSize:'1.1rem'
          }}>←</button>
          <div>
            <h2 style={{color:'white',margin:0,fontSize:'1.2rem'}}>保護者を選択</h2>
            <p style={{color:'rgba(255,255,255,0.8)',margin:0,fontSize:'0.82rem'}}>チャットしたい保護者をタップ</p>
          </div>
        </div>

        <div style={{background:'white',margin:'0 1rem',borderRadius:'16px',overflow:'hidden',boxShadow:'0 4px 16px rgba(0,0,0,0.15)'}}>
          {parents.map((parent, i) => (
            <div key={parent.id} onClick={() => openChat(parent)}
              style={{
                display:'flex',alignItems:'center',gap:'1rem',padding:'1rem 1.25rem',cursor:'pointer',
                borderBottom: i < parents.length-1 ? '1px solid #f0f0f0' : 'none',
                background:'white',transition:'background 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background='#f8f9fa'}
              onMouseLeave={(e) => e.currentTarget.style.background='white'}
            >
              <div style={{
                width:'52px',height:'52px',borderRadius:'50%',flexShrink:0,
                background: parent.avatar_url ? 'white' : 'linear-gradient(135deg,#667eea,#d97706)',
                display:'flex',alignItems:'center',justifyContent:'center',
                color:'white',fontWeight:'700',fontSize:'1.3rem',overflow:'hidden',
                border: parent.avatar_url ? '2px solid #e9ecef' : 'none',
                boxShadow:'0 2px 8px rgba(0,0,0,0.1)'
              }}>
                {parent.avatar_url
                  ? <img src={parent.avatar_url} alt={parent.name} style={{width:'100%',height:'100%',objectFit:'cover'}} />
                  : 'P'}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <h4 style={{margin:0,fontSize:'1rem',fontWeight:'600',color:'#333'}}>{parent.name}</h4>
                <p style={{margin:'0.25rem 0 0',fontSize:'0.82rem',color:'#999',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{parent.email}</p>
              </div>
              <div style={{
                display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.5rem 1rem',
                background:'linear-gradient(135deg,#667eea,#764ba2)',
                color:'white',borderRadius:'20px',fontSize:'0.85rem',fontWeight:'600',flexShrink:0
              }}>
                <MessageCircle size={15} /> チャット
              </div>
            </div>
          ))}
        </div>

        <div style={{padding:'1rem'}}>
          <button onClick={() => setCurrentView('child-dashboard')} style={{
            width:'100%',padding:'0.875rem',background:'rgba(255,255,255,0.2)',
            color:'white',border:'2px solid rgba(255,255,255,0.4)',
            borderRadius:'12px',fontSize:'1rem',fontWeight:'600',cursor:'pointer'
          }}>キャンセル</button>
        </div>
      </div>
    );
  };

  // ===== 子供ダッシュボード =====
  const ChildDashboard = () => {
    const [showSOSModal, setShowSOSModal] = useState(false);
    const [showLostModal, setShowLostModal] = useState(false);
    const [showIDModal, setShowIDModal] = useState(false);
    const [parents, setParents] = useState([]);

    const myProfile = members.find(m => m.userId === currentUser?.id);

    useEffect(() => {
      if (currentUser?.id) loadParents();
    }, [currentUser?.id]);

    const loadParents = async () => {
      if (!currentUser?.id) return;
      try {
        const { data: rels } = await supabase
          .from('parent_children').select('parent_id').eq('child_id', currentUser.id);
        if (rels && rels.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles').select('*').in('id', rels.map(r => r.parent_id));
          if (profiles) {
            setParents(profiles);
            sessionStorage.setItem('chatParentList', JSON.stringify(profiles));
          }
        }
      } catch (e) { console.error(e); }
    };

    // 保護者ボタンクリック → 独立ビューへ遷移
    const handleParentBtnClick = () => {
      if (parents.length === 0) {
        alert('保護者が登録されていません');
      } else if (parents.length === 1) {
        sessionStorage.setItem('chatParent', JSON.stringify(parents[0]));
        setCurrentView('parent-chat');
      } else {
        sessionStorage.setItem('chatParentList', JSON.stringify(parents));
        setCurrentView('parent-list');
      }
    };

    const sendSOS = async () => {
      if (!myProfile) return;
      try {
        await supabase.from('members').update({ status: 'danger' }).eq('id', myProfile.id);
        await supabase.from('alerts').insert([{
          member_id: myProfile.id, type: 'sos',
          message: `${currentUser.name}からSOSアラートが送信されました！`, read: false
        }]);
        setMembers(prev => prev.map(m => m.id === myProfile.id ? { ...m, status: 'danger' } : m));
        alert('SOSアラートを送信しました！保護者に通知されます。');
        setShowSOSModal(false);
      } catch (e) { alert('アラートの送信に失敗しました'); }
    };

    const sendLostAlert = async () => {
      if (!myProfile) return;
      try {
        await supabase.from('members').update({ status: 'warning', gps_enabled: true }).eq('id', myProfile.id);
        await supabase.from('alerts').insert([{
          member_id: myProfile.id, type: 'lost',
          message: `${currentUser.name}が道に迷っています`, read: false
        }]);
        setMembers(prev => prev.map(m => m.id === myProfile.id ? { ...m, status: 'warning', gpsActive: true } : m));
        setGpsEnabled(true);
        startChildGPSTracking();
        alert('道に迷ったアラートを送信し、GPS追跡を開始しました');
        setShowLostModal(false);
      } catch (e) { alert('アラートの送信に失敗しました'); }
    };

    // ID共有
    const handleShareID = async () => {
      const id = currentUser?.id;
      if (!id) return;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Family Safe - ユーザーID',
            text: `Family SafeのユーザーIDです：\n${id}\n\nこのIDを保護者に伝えて、家族に追加してもらってください。`,
          });
        } catch (e) {
          if (e.name !== 'AbortError') copyID();
        }
      } else {
        copyID();
      }
    };

    const copyID = async () => {
      try {
        await navigator.clipboard.writeText(currentUser?.id || '');
        alert('IDをコピーしました！');
      } catch (e) {
        alert('コピーに失敗しました。手動でコピーしてください。');
      }
    };

    if (dataLoading && !myProfile) {
      return (
        <div className="child-dashboard">
          <header className="child-header"><h1>Family Safe</h1></header>
          <div className="loading-screen">
            <div className="loading-content">
              <div className="spinner"></div>
              <p className="loading-text">データを読み込んでいます...</p>
            </div>
          </div>
        </div>
      );
    }

    if (!myProfile) {
      return (
        <div className="child-dashboard">
          <header className="child-header"><h1>Family Safe</h1></header>
          <div style={{padding:'2rem',textAlign:'center'}}>
            <div className="error-message">
              プロフィールが見つかりません。<br/>ログアウトして再度ログインしてください。
            </div>
            <button onClick={async () => {
              await supabase.auth.signOut();
              setCurrentUser(null); setCurrentView('login');
            }} className="register-btn primary" style={{marginTop:'1rem'}}>ログアウト</button>
          </div>
        </div>
      );
    }

    return (
      <div className="child-dashboard">
        <header className="child-header">
          <h1>Family Safe</h1>
          <div className="child-header-buttons">
            <button className="group-btn" onClick={() => setCurrentView('group-list')}>
              <Users size={18} /> グループ
            </button>
            <button className="parent-btn" onClick={handleParentBtnClick}>
              <MessageCircle size={18} /> 保護者
              {parents.length > 1 && (
                <span style={{background:'rgba(255,255,255,0.35)',borderRadius:'10px',padding:'1px 6px',fontSize:'0.72rem',fontWeight:'700',marginLeft:'2px'}}>
                  {parents.length}
                </span>
              )}
            </button>
            <button className="id-btn" onClick={() => setShowIDModal(true)}>
              <User size={18} /> ID確認
            </button>
            <button className="profile-btn" onClick={() => setCurrentView('profile')}>
              <Settings size={18} />
            </button>
          </div>
        </header>

        <div className="child-content">
          {/* ステータス */}
          <div className="status-card">
            <div className={`status-indicator ${myProfile.status}`}>
              {myProfile.status === 'safe' ? <Check size={24} /> :
               myProfile.status === 'warning' ? <Navigation size={24} /> :
               <AlertTriangle size={24} />}
              <span>
                {myProfile.status === 'safe' ? '安全です' :
                 myProfile.status === 'warning' ? '道に迷っています' : '緊急アラート発信中'}
              </span>
            </div>
          </div>

          {/* 現在地 */}
          <div className="destination-card">
            <h2>現在地</h2>
            <div className="current-location">
              <MapPin size={20} />
              <p>{myProfile.location.address}</p>
            </div>
            <p style={{fontSize:'0.85rem',color:'#999',marginTop:'0.75rem'}}>
              最終更新: {myProfile.lastUpdate.toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
            </p>
          </div>

          {/* バッテリー・GPS */}
          <div className="child-info-grid">
            <div className="info-box">
              <Battery size={24} className="info-icon" />
              <div><h3>バッテリー</h3><div className="info-value">{myProfile.battery}%</div></div>
            </div>
            <div className="info-box">
              <Clock size={24} className="info-icon" />
              <div>
                <h3>GPS状態</h3>
                <div className="info-value" style={{fontSize:'0.9rem'}}>{myProfile.gpsActive ? '追跡中' : 'オフ'}</div>
              </div>
            </div>
          </div>

          {/* 位置情報共有 */}
          <div className="destination-card">
            <h2>位置情報の共有</h2>
            <div className="gps-control">
              {!gpsEnabled ? (
                <>
                  <button className="gps-toggle" onClick={startChildGPSTracking}>
                    <Navigation size={20} /> 継続的に位置を共有する
                  </button>
                  <button className="gps-toggle refresh" onClick={() => updateLocationOnce(myProfile.id)}>
                    <MapPin size={20} /> 今の位置を1回共有する
                  </button>
                </>
              ) : (
                <button className="gps-toggle active">
                  <Navigation size={20} /> GPS追跡中...
                </button>
              )}
            </div>
            <p style={{fontSize:'0.85rem',color:'#999',marginTop:'0.75rem',textAlign:'center'}}>
              {gpsEnabled ? '保護者があなたの位置を追跡しています' : '位置情報を共有すると保護者が確認できます'}
            </p>
          </div>

          {/* スケジュール */}
          {myProfile.schedule && myProfile.schedule.length > 0 && (
            <div className="destination-card">
              <h2><Calendar size={20} style={{verticalAlign:'middle',marginRight:'0.5rem'}} />今日のスケジュール</h2>
              <div style={{display:'flex',flexDirection:'column',gap:'0.75rem',marginTop:'1rem'}}>
                {myProfile.schedule.map(item => (
                  <div key={item.id} className="child-schedule-item">
                    <div className="child-schedule-time">{item.time.substring(0,5)}</div>
                    <div className="child-schedule-content">
                      <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.25rem'}}>
                        <h4 style={{margin:0,fontSize:'1rem',fontWeight:'600',color:'#333'}}>{item.title}</h4>
                        <span className={`child-schedule-badge ${item.type}`}>{item.type==='departure'?'出発':'到着'}</span>
                      </div>
                      <p style={{margin:0,fontSize:'0.85rem',color:'#666',display:'flex',alignItems:'center',gap:'0.25rem'}}>
                        <MapPin size={12} />{item.location}
                      </p>
                    </div>
                    <div style={{flexShrink:0}}>
                      {item.completed
                        ? <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'#10b981',color:'white',display:'flex',alignItems:'center',justifyContent:'center'}}><Check size={18}/></div>
                        : <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'#f0f0f0',color:'#999',display:'flex',alignItems:'center',justifyContent:'center'}}><Clock size={18}/></div>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 緊急連絡 */}
          <div className="emergency-section">
            <h2>緊急連絡</h2>
            <div className="emergency-buttons">
              <button className="emergency-btn lost" onClick={() => setShowLostModal(true)}>
                <Navigation size={32} /> 道に迷った
              </button>
              <button className="emergency-btn sos" onClick={() => setShowSOSModal(true)}>
                <AlertTriangle size={32} /> SOSアラート
              </button>
            </div>
          </div>
        </div>

        {/* SOS */}
        {showSOSModal && (
          <div className="emergency-modal">
            <div className="emergency-dialog">
              <AlertTriangle size={72} className="emergency-icon" />
              <h2>SOSアラート</h2>
              <p>緊急事態ですか？</p>
              <p className="emergency-warning">このボタンを押すと、すべての保護者に緊急通知が送られます。</p>
              <div className="emergency-actions">
                <button className="cancel-sos" onClick={() => setShowSOSModal(false)}>キャンセル</button>
                <button className="confirm-sos" onClick={sendSOS}>SOS送信</button>
              </div>
            </div>
          </div>
        )}

        {/* 道に迷った */}
        {showLostModal && (
          <div className="emergency-modal">
            <div className="emergency-dialog">
              <Navigation size={72} style={{color:'#f59e0b',marginBottom:'1rem'}} />
              <h2>道に迷いましたか？</h2>
              <p>保護者に通知を送り、GPS追跡を開始します。</p>
              <div className="emergency-actions">
                <button className="cancel-sos" onClick={() => setShowLostModal(false)}>キャンセル</button>
                <button className="confirm-sos" onClick={sendLostAlert} style={{background:'#f59e0b'}}>通知を送る</button>
              </div>
            </div>
          </div>
        )}

        {/* ID確認（共有機能付き） */}
{showIDModal && (
  <div className="emergency-modal">
    <div className="emergency-dialog">
      <User size={48} style={{color:'#667eea', marginBottom:'0.5rem'}} />
      <h2>あなたのID</h2>
      <p style={{fontSize:'0.9rem', color:'#666', marginBottom:'1rem'}}>
        保護者にQRコードを読み取ってもらうか、6桁のIDを伝えてください
      </p>

      {/* 6桁ID */}
      <div style={{
        fontSize: '2.5rem', fontWeight: '800', letterSpacing: '0.3em',
        color: '#667eea', background: '#f0f4ff', borderRadius: '16px',
        padding: '1rem 1.5rem', marginBottom: '1.25rem'
      }}>
        {currentUser?.short_id || '------'}
      </div>

      {/* QRコード */}
      {currentUser?.short_id && (
        <div style={{marginBottom: '1.25rem'}}>
          <QRCodeCanvas
            value={`${window.location.origin}/#add-${currentUser.short_id}`}
            size={200}
            bgColor="#ffffff"
            fgColor="#667eea"
            level="M"
            includeMargin={true}
          />
          <p style={{fontSize:'0.8rem', color:'#999', marginTop:'0.5rem'}}>
            保護者がカメラで読み取ると自動追加されます
          </p>
        </div>
      )}

      {/* 共有ボタン */}
      <button onClick={handleShareID} style={{
        width:'100%', padding:'0.875rem', marginBottom:'0.75rem',
        background:'linear-gradient(135deg,#667eea,#764ba2)',
        color:'white', border:'none', borderRadius:'12px',
        fontSize:'1rem', fontWeight:'700', cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:'0.5rem'
      }}>
        IDを共有する（LINE・メール等）
      </button>

      <button onClick={copyID} style={{
        width:'100%', padding:'0.875rem', marginBottom:'0.75rem',
        background:'white', color:'#667eea',
        border:'2px solid #667eea', borderRadius:'12px',
        fontSize:'1rem', fontWeight:'600', cursor:'pointer'
      }}>
        IDをコピー
      </button>

      <button className="cancel-sos" onClick={() => setShowIDModal(false)} style={{width:'100%'}}>
        閉じる
      </button>
    </div>
  </div>
)}
      </div>
    );
  };

  // ルーティング（最終部分）
  if (currentView === 'login') return <LoginScreen />;
  if (currentView === 'register') return <RegisterScreen />;
  if (currentView === 'qr-register') return <QRRegisterScreen />;
  if (currentView === 'role-selection') return <RoleSelectionScreen />;
  if (currentView === 'add-child') return <AddChildScreen />;
  if (currentView === 'profile') return <ProfileScreen />;
  if (currentView === 'group-list') return <GroupListScreen />;
  if (currentView === 'create-group') return <CreateGroupScreen />;
  if (currentView === 'group-chat') return <GroupChatScreen />;
  if (currentView === 'parent-dashboard') return <ParentDashboard />;
  if (currentView === 'child-dashboard') return <ChildDashboard />;
  if (currentView === 'parent-chat') return <ParentChatScreen />;
  if (currentView === 'parent-list') return <ParentListScreen />;
  if (currentView === 'parent-chat-direct') return <ParentChatDirectScreen />;

  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="spinner"></div>
        <p className="loading-text">読み込み中...</p>
      </div>
    </div>
  );
};

export default App
