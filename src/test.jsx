// ============================================
// Family Safe - App.jsx (Part 1/3)
// ============================================

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  MapPin, AlertTriangle, Activity, Battery, Clock, User, Mail, 
  Shield, Users, LogOut, Navigation, Phone, MessageCircle, Calendar,
  Home, ShoppingBag, Plane, MoreHorizontal, Bell, Check,
  Send, X, Plus, Edit, Settings, ChevronRight, School
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Supabase設定
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

console.log('🔧 Family Safe - Initializing...');
console.log('📍 Supabase URL:', supabaseUrl);
console.log('🔑 Anon Key exists:', !!supabaseAnonKey);

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
          avatar: data.role === 'parent' ? 'P' : 'C'
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
          return;
        }

        if (!relationships || relationships.length === 0) {
          setMembers([]);
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
          return;
        }

        if (data && data.length > 0) {
          const profileIds = data.map(m => m.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name')
            .in('id', profileIds);
          
          const profileMap = {};
          if (profiles) {
            profiles.forEach(p => {
              profileMap[p.id] = p.name;
            });
          }

          const formattedMembers = data.map(m => ({
            id: m.id,
            userId: m.user_id,
            name: profileMap[m.user_id] || m.name,
            avatar: 'C',
            status: m.status || 'safe',
            location: { 
              lat: m.latitude || 35.6812, 
              lng: m.longitude || 139.7671, 
              address: m.address || '位置情報未取得' 
            },
            battery: m.battery || 100,
            lastUpdate: new Date(m.last_update || Date.now()),
            isMoving: m.gps_active || false,
            gpsActive: m.gps_active || false,
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
        const { data, error } = await supabase
          .from('members')
          .select('*')
          .eq('user_id', user.id);

        if (error) {
          console.error('Members load error:', error);
          return;
        }

        if (data && data.length > 0) {
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
            isMoving: memberData.gps_active || false,
            gpsActive: memberData.gps_active || false,
            locationHistory: [],
            schedule: [],
            destination: null
          };
          setMembers([myProfile]);
          setGpsEnabled(memberData.gps_active || false);
          
          await Promise.all([
            loadSchedules(myProfile.id),
            loadDestination(myProfile.id),
            loadActivityHistory(myProfile.id)
          ]);
        } else {
          const { data: newMember } = await supabase
            .from('members')
            .insert([{
              user_id: user.id,
              name: user.name,
              status: 'safe',
              battery: batteryLevel,
              gps_active: false
            }])
            .select()
            .single();

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
          }
        }
      }
    } catch (error) {
      console.error('Load members error:', error);
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
      const { data } = await supabase
        .from('location_history')
        .select('*')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(50);
      
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
      const { data: relationships } = await supabase
        .from('parent_children')
        .select('child_id')
        .eq('parent_id', user.id);
      
      if (!relationships) return;
      
      const childIds = relationships.map(r => r.child_id);
      
      const { data: membersData } = await supabase
        .from('members')
        .select('id')
        .in('user_id', childIds);
      
      if (!membersData) return;
      
      const memberIds = membersData.map(m => m.id);
      
      const { data: alertsData } = await supabase
        .from('alerts')
        .select('*')
        .in('member_id', memberIds)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (alertsData) {
        setAlerts(alertsData.map(a => ({
          id: a.id,
          type: a.type,
          memberId: a.member_id,
          message: a.message,
          timestamp: new Date(a.created_at),
          read: a.read
        })));
      }
    } catch (error) {
      console.error('Load alerts error:', error);
    }
  };

// Part 1 終了 - Part 2に続く
// ============================================
// Family Safe - App.jsx (Part 2/3)
// ============================================
// Part 1からの続き

  // メッセージのリアルタイム購読
  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel('messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `to_user_id=eq.${currentUser.id}`
        },
        (payload) => {
          setMessages(prev => [...prev, {
            id: payload.new.id,
            from: payload.new.from_user_id,
            to: payload.new.to_user_id,
            text: payload.new.text,
            timestamp: new Date(payload.new.created_at),
            read: payload.new.read
          }]);
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
        (payload) => {
          setAlerts(prev => [{
            id: payload.new.id,
            type: payload.new.type,
            memberId: payload.new.member_id,
            message: payload.new.message,
            timestamp: new Date(payload.new.created_at),
            read: payload.new.read
          }, ...prev]);
          
          if (Notification.permission === 'granted') {
            new Notification('Family Safe - 緊急アラート', {
              body: payload.new.message,
              icon: '/icon.png',
              badge: '/badge.png',
              tag: 'family-safe-alert',
              requireInteraction: true
            });
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
          const newGpsState = payload.new.gps_active;
          console.log('GPS state changed:', newGpsState);
          setGpsEnabled(newGpsState);
          
          // 親がGPSを停止した場合、子供側のwatchPositionもクリア
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

  // GPS状態のリアルタイム購読（親側）- 子供のGPS状態変更を監視
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
                gpsActive: payload.new.gps_active,
                isMoving: payload.new.gps_active,
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

  // GPS追跡開始（親が子供のGPSを遠隔制御）
  const startGPSTracking = async (memberId) => {
    try {
      await supabase
        .from('members')
        .update({ gps_active: true })
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
      
      // DBのGPS状態を無効化
      const { error } = await supabase
        .from('members')
        .update({ gps_active: false })
        .eq('id', memberId);
      
      if (error) {
        console.error('Stop GPS error:', error);
        alert('GPS追跡の停止に失敗しました');
        return;
      }
      
      setMembers(prev => prev.map(m => 
        m.id === memberId ? { ...m, gpsActive: false, isMoving: false } : m
      ));
      
      // 自分自身の場合はwatchPositionもクリア
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
      .update({ gps_active: true })
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

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        try {
          await supabase
            .from('location_history')
            .insert([{
              member_id: memberId,
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
            .eq('id', memberId);
          
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
          
          alert('位置情報を更新しました');
        } catch (error) {
          console.error('Location update error:', error);
          alert('位置情報の更新に失敗しました');
        }
      },
      (error) => {
        console.error('GPS Error:', error);
        if (error.code === error.PERMISSION_DENIED) {
          alert('位置情報の許可が必要です');
        } else {
          alert('位置情報の取得に失敗しました');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
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

  // ============================================
  // 画面コンポーネント
  // ============================================

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
          </div>
        </div>
      </div>
    );
  };

// Part 2 終了 - Part 3に続く (RegisterScreen, RoleSelection, AddChild, GroupChat, ParentDashboard, ChildDashboard, ProfileScreen)
// ============================================
// Family Safe - App.jsx (Part 3/4)
// ============================================
// Part 2からの続き

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

  // グループチャット画面
  const GroupChatScreen = () => {
    const [newMessage, setNewMessage] = useState('');
    const [groupMembers, setGroupMembers] = useState([]);

    useEffect(() => {
      loadGroupMessages();
      loadGroupMembers();
    }, []);

    useEffect(() => {
      if (!currentUser) return;

      const channel = supabase
        .channel('group-messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'group_messages'
          },
          async (payload) => {
            const { data: profile } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', payload.new.user_id)
              .single();
            
            setGroupMessages(prev => [...prev, {
              id: payload.new.id,
              userId: payload.new.user_id,
              userName: profile?.name || '不明',
              text: payload.new.text,
              timestamp: new Date(payload.new.created_at)
            }]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [currentUser]);

    const loadGroupMessages = async () => {
      try {
        const { data } = await supabase
          .from('group_messages')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(100);
        
        if (data) {
          const userIds = [...new Set(data.map(m => m.user_id))];
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name')
            .in('id', userIds);
          
          const nameMap = {};
          if (profiles) {
            profiles.forEach(p => {
              nameMap[p.id] = p.name;
            });
          }
          
          setGroupMessages(data.map(m => ({
            id: m.id,
            userId: m.user_id,
            userName: nameMap[m.user_id] || '不明',
            text: m.text,
            timestamp: new Date(m.created_at)
          })));
        }
      } catch (error) {
        console.error('Load group messages error:', error);
      }
    };

    const loadGroupMembers = async () => {
      try {
        if (currentUser.role === 'parent') {
          // 保護者の場合：自分と子供たち
          const { data: relationships } = await supabase
            .from('parent_children')
            .select('child_id')
            .eq('parent_id', currentUser.id);
          
          if (relationships) {
            const childIds = relationships.map(r => r.child_id);
            const allIds = [currentUser.id, ...childIds];
            
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, name, role')
              .in('id', allIds);
            
            if (profiles) {
              setGroupMembers(profiles.map(p => ({
                id: p.id,
                name: p.name,
                role: p.role,
                isOnline: true
              })));
            }
          }
        } else {
          // 子供の場合：自分と保護者
          const { data: relationships } = await supabase
            .from('parent_children')
            .select('parent_id')
            .eq('child_id', currentUser.id);
          
          if (relationships && relationships.length > 0) {
            const parentIds = relationships.map(r => r.parent_id);
            const allIds = [currentUser.id, ...parentIds];
            
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, name, role')
              .in('id', allIds);
            
            if (profiles) {
              setGroupMembers(profiles.map(p => ({
                id: p.id,
                name: p.name,
                role: p.role,
                isOnline: true
              })));
            }
          }
        }
      } catch (error) {
        console.error('Load group members error:', error);
      }
    };

    const sendGroupMessage = async () => {
      if (!newMessage.trim()) return;
      
      try {
        await supabase
          .from('group_messages')
          .insert([{
            user_id: currentUser.id,
            text: newMessage
          }]);

        setNewMessage('');
      } catch (error) {
        console.error('Send group message error:', error);
      }
    };

    return (
      <div className="chat-modal">
        <div className="chat-container">
          <div className="chat-header">
            <div className="chat-user">
              <span className="chat-avatar">
                <Users size={24} />
              </span>
              <div>
                <h3>家族グループ</h3>
                <p style={{fontSize: '0.75rem', color: '#999', margin: 0}}>
                  {groupMembers.length}人のメンバー
                </p>
              </div>
            </div>
            <button 
              className="close-btn"
              onClick={() => setCurrentView(currentUser?.role === 'parent' ? 'parent-dashboard' : 'child-dashboard')}
            >
              <X size={20} />
            </button>
          </div>

          <div style={{padding: '1rem', background: '#f8f9fa', borderBottom: '1px solid #e9ecef'}}>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.5rem'}}>
              {groupMembers.map(member => (
                <div 
                  key={member.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    background: 'white',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    border: '1px solid #e9ecef'
                  }}
                >
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: member.isOnline ? '#10b981' : '#999'
                  }}></div>
                  <span style={{fontWeight: '600'}}>
                    {member.name}
                    {member.id === currentUser.id && ' (あなた)'}
                  </span>
                  <span style={{color: '#999', fontSize: '0.75rem'}}>
                    {member.role === 'parent' ? '保護者' : '子供'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="chat-messages">
            {groupMessages.map(msg => (
              <div 
                key={msg.id} 
                className={'message ' + (msg.userId === currentUser.id ? 'sent' : 'received')}
              >
                <div className="message-bubble">
                  {msg.userId !== currentUser.id && (
                    <div style={{fontSize: '0.75rem', fontWeight: '600', marginBottom: '0.25rem', opacity: 0.8}}>
                      {msg.userName}
                    </div>
                  )}
                  <p>{msg.text}</p>
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem'}}>
                    <small>{msg.timestamp.toLocaleTimeString('ja-JP', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}</small>
                    {msg.userId === currentUser.id && (
                      <button
                        onClick={async () => {
                          if (!confirm('このメッセージを削除しますか？')) return;
                          try {
                            await supabase
                              .from('group_messages')
                              .delete()
                              .eq('id', msg.id);
                            setGroupMessages(prev => prev.filter(m => m.id !== msg.id));
                          } catch (error) {
                            console.error('Delete message error:', error);
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '0.25rem',
                          fontSize: '0.75rem',
                          opacity: 0.7
                        }}
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="chat-input">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendGroupMessage()}
              placeholder="メッセージを入力..."
            />
            <button onClick={sendGroupMessage} className="send-btn">
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  };

// Part 3 終了 - Part 4に続く（ParentDashboard, ChildDashboard, ProfileScreen, ルーティング）
// ============================================
// Family Safe - App.jsx (Part 4/4 - FINAL)
// ============================================
// Part 3からの続き - 最終パート

  // 親ダッシュボード（簡略版 - 主要機能のみ）
  const ParentDashboard = () => {
    const [selectedMemberId, setSelectedMemberId] = useState(null);
    const [showChat, setShowChat] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [activeTab, setActiveTab] = useState('map');
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showMemberManagement, setShowMemberManagement] = useState(false);
    const [scheduleForm, setScheduleForm] = useState({
      title: '',
      time: '',
      type: 'departure',
      location: ''
    });

    const myChildren = members;
    const unreadAlerts = alerts.filter(a => !a.read).length;
    const displayMember = useMemo(() => {
      if (selectedMemberId) {
        return members.find(m => m.id === selectedMemberId) || null;
      }
      return members[0] || null;
    }, [selectedMemberId, members]);

    useEffect(() => {
      if (!selectedMemberId && members.length > 0) {
        setSelectedMemberId(members[0].id);
      }
    }, [members.length, selectedMemberId]);

    const sendMessage = async () => {
      if (!newMessage.trim() || !displayMember) return;
      
      try {
        await supabase
          .from('messages')
          .insert([{
            from_user_id: currentUser.id,
            to_user_id: displayMember.userId,
            text: newMessage,
            read: false
          }]);
        setNewMessage('');
      } catch (error) {
        console.error('Send message error:', error);
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
                  <div className="member-avatar">{member.avatar}</div>
                  <div className="member-info">
                    <h3>{member.name}</h3>
                    <div className="member-status">
                      <span className={'status-dot ' + member.status}></span>
                      <span className="status-text">
                        {member.status === 'safe' ? '安全' : member.status === 'warning' ? '警告' : '危険'}
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
                style={{marginTop: '0.5rem', background: '#f59e0b'}}
              >
                <Users size={18} />
                メンバー管理
              </button>
            </div>
            {displayMember && (
              <div className="quick-actions">
                <button className="action-btn group-btn" onClick={() => setCurrentView('group-chat')}>
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
                      <div style={{height: '400px', width: '100%', borderRadius: '16px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', padding: '2rem', position: 'relative', overflow: 'hidden'}}>
                        <MapPin size={64} style={{marginBottom: '1rem', zIndex: 1}} />
                        <h3 style={{fontSize: '1.5rem', marginBottom: '0.5rem', zIndex: 1}}>{displayMember.name}の位置</h3>
                        <p style={{fontSize: '1rem', opacity: 0.9, textAlign: 'center', zIndex: 1}}>
                          緯度: {displayMember.location.lat.toFixed(6)}°<br/>
                          経度: {displayMember.location.lng.toFixed(6)}°
                        </p>
                        <a 
                          href={'https://www.google.com/maps?q=' + displayMember.location.lat + ',' + displayMember.location.lng}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{marginTop: '1.5rem', padding: '0.75rem 1.5rem', background: 'white', color: '#667eea', borderRadius: '8px', textDecoration: 'none', fontWeight: '600', zIndex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem'}}
                        >
                          <i className="fas fa-external-link-alt"></i>
                          Google Mapsで開く
                        </a>
                      </div>
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
                              <div className="schedule-status">
                                {item.completed ? (
                                  <Check size={20} className="check-icon" />
                                ) : (
                                  <Clock size={20} className="pending-icon" />
                                )}
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
                                <p className="activity-location">{activity.address}</p>
                                <small className="activity-time">
                                  {new Date(activity.timestamp).toLocaleString('ja-JP')}
                                </small>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{textAlign: 'center', padding: '3rem', color: '#999'}}>
                            <Activity size={48} style={{marginBottom: '1rem', opacity: 0.5}} />
                            <p>活動履歴はありません</p>
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
          <div className="chat-modal">
            <div className="chat-container">
              <div className="chat-header">
                <div className="chat-user">
                  <span className="chat-avatar">{displayMember.avatar}</span>
                  <h3>{displayMember.name}</h3>
                </div>
                <button className="close-btn" onClick={() => setShowChat(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="chat-messages">
                {messages.filter(m => (m.from === currentUser.id && m.to === displayMember.userId) || (m.from === displayMember.userId && m.to === currentUser.id)).map(msg => (
                  <div key={msg.id} className={'message ' + (msg.from === currentUser.id ? 'sent' : 'received')}>
                    <div className="message-bubble">
                      <p>{msg.text}</p>
                      <small>{msg.timestamp.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}</small>
                    </div>
                  </div>
                ))}
              </div>
              <div className="chat-input">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && sendMessage()} placeholder="メッセージを入力..." />
                <button onClick={sendMessage} className="send-btn">
                  <Send size={20} />
                </button>
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
                              状態: {member.status === 'safe' ? '安全' : '警告'}
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

  // 子供ダッシュボード（簡略版）
  const ChildDashboard = () => {
    const myProfile = members.find(m => m.userId === currentUser?.id);
    const [showEmergency, setShowEmergency] = useState(false);
    const [showIdCard, setShowIdCard] = useState(false);
    const [copied, setCopied] = useState(false);

    const sendSOS = async () => {
      try {
        await supabase.from('alerts').insert([{member_id: myProfile.id, type: 'sos', message: myProfile.name + 'から緊急通報！'}]);
        alert('緊急通報を送信しました！');
        setShowEmergency(false);
        if (Notification.permission === 'granted') {
          new Notification('Family Safe - 緊急通報', {body: '緊急通報を保護者に送信しました', requireInteraction: true});
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
        alert('迷子アラートを送信し、GPS追跡を開始しました！');
        
        // GPS自動起動
        if (!gpsEnabled) {
          await startChildGPSTracking();
        }
        
        // ブラウザ通知
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
          <h1><i className="fas fa-child" style={{marginRight: '0.5rem'}}></i>{myProfile.name}</h1>
          <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
            <button onClick={() => setCurrentView('group-chat')} style={{padding: '0.5rem 1rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
              <Users size={18} />グループ
            </button>
            <button onClick={() => setShowIdCard(true)} style={{padding: '0.5rem 1rem', background: '#667eea', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
              <i className="fas fa-shield-alt"></i>マイID
            </button>
            <button onClick={async () => {
              if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
              }
              await supabase.auth.signOut();
              setCurrentUser(null);
              setCurrentView('login');
            }} className="logout-btn-simple">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="child-content">
          <div className="status-card">
            <div className={'status-indicator ' + myProfile.status}>
              {myProfile.status === 'safe' ? <><i className="fas fa-check-circle"></i> 安全です</> : <><i className="fas fa-exclamation-triangle"></i> 注意</>}
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
            <button onClick={() => gpsEnabled ? null : startChildGPSTracking()} className={'gps-toggle ' + (gpsEnabled ? 'active' : '')} disabled={gpsEnabled} title={gpsEnabled ? '親が停止するまで追跡は継続されます' : 'GPS追跡を開始'}>
              <Navigation size={24} />
              <span>{gpsEnabled ? 'GPS追跡中（親が制御中）' : 'GPS開始'}</span>
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
              <p className="emergency-warning">親に緊急通知が送られます</p>
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
      </div>
    );
  };

  // プロフィール画面（簡略版）
  const ProfileScreen = () => {
    const [copied, setCopied] = useState(false);

    const copyUserId = () => {
      navigator.clipboard.writeText(currentUser.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="profile-screen">
        <header className="profile-header">
          <button onClick={() => setCurrentView(currentUser?.role === 'parent' ? 'parent-dashboard' : 'child-dashboard')} className="back-btn">
            <i className="fas fa-arrow-left"></i> 戻る
          </button>
          <h1>マイプロフィール</h1>
        </header>

        <div className="profile-content">
          <div className="profile-card">
            <div className="profile-avatar-large">
              <i className="fas fa-user-circle" style={{fontSize: '3rem'}}></i>
            </div>
            <h2>{currentUser?.name}</h2>
            <p className="profile-role">{currentUser?.role === 'parent' ? '保護者' : 'お子様'}</p>
          </div>

          <div className="profile-details">
            <div className="detail-item">
              <User size={20} />
              <div><label>名前</label><p>{currentUser?.name}</p></div>
            </div>
            <div className="detail-item">
              <Mail size={20} />
              <div><label>メールアドレス</label><p>{currentUser?.email}</p></div>
            </div>
            <div className="detail-item">
              <Phone size={20} />
              <div><label>電話番号</label><p>{currentUser?.phone || '未設定'}</p></div>
            </div>
          </div>

          {currentUser?.role === 'child' && (
            <div style={{background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '1.5rem', borderRadius: '16px', margin: '1.5rem 0', color: 'white'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem'}}>
                <Shield size={24} />
                <h3 style={{margin: 0, fontSize: '1.1rem'}}>ユーザーID</h3>
              </div>
              <p style={{fontSize: '0.85rem', marginBottom: '1rem', opacity: 0.9}}>保護者に共有するIDです</p>
              <div style={{background: 'rgba(255,255,255,0.15)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', wordBreak: 'break-all', fontSize: '0.8rem', fontFamily: 'monospace'}}>
                {currentUser?.id}
              </div>
              <button onClick={copyUserId} style={{width: '100%', padding: '0.875rem', background: copied ? '#4CAF50' : 'white', color: copied ? 'white' : '#667eea', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s'}}>
                {copied ? <><i className="fas fa-check-circle"></i>コピーしました！</> : <><i className="far fa-clipboard"></i> IDをコピー</>}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // ルーティング（最終部分）
  // ============================================
  if (currentView === 'login') return <LoginScreen />;
  if (currentView === 'register') return <RegisterScreen />;
  if (currentView === 'role-selection') return <RoleSelectionScreen />;
  if (currentView === 'add-child') return <AddChildScreen />;
  if (currentView === 'group-chat') return <GroupChatScreen />;
  if (currentView === 'parent-dashboard') return <ParentDashboard />;
  if (currentView === 'child-dashboard') return <ChildDashboard />;
  if (currentView === 'profile') return <ProfileScreen />;
  
  return null;
};

export default App;