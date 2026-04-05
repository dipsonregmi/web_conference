/**
 * Nexus Meet - WebRTC Logic using PeerJS
 */

// UI Elements
const landingPage = document.getElementById('landing-page');
const roomPage = document.getElementById('room-page');
const btnCreateMeeting = document.getElementById('btn-create-meeting');
const inputUsername = document.getElementById('input-username');
const inputMeetingCode = document.getElementById('input-meeting-code');
const btnJoinMeeting = document.getElementById('btn-join-meeting');
const displayMeetingCode = document.getElementById('display-meeting-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const videoGrid = document.getElementById('video-grid');
const hostBadge = document.getElementById('host-badge');

// Controls
const btnToggleMic = document.getElementById('btn-toggle-mic');
const btnToggleVideo = document.getElementById('btn-toggle-video');
const btnRaiseHand = document.getElementById('btn-raise-hand');
const btnShareScreen = document.getElementById('btn-share-screen');
const btnRecord = document.getElementById('btn-record');
const btnLeave = document.getElementById('btn-leave');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const sidebar = document.getElementById('sidebar');

// Tabs & Chat
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const chatInput = document.getElementById('chat-input');
const btnSendChat = document.getElementById('btn-send-chat');
const chatMessages = document.getElementById('chat-messages');
const participantsList = document.getElementById('participants-list');
const peopleCount = document.getElementById('people-count');

// State state
let myPeer;
let myPeerId;
let isHost = false;
let hostId = null;
let roomPeers = {}; // { peerId: { call, conn, joinTime, isMuted, metadata } }
let localStream = null;
let screenStream = null;
let isVideoMuted = false;
let isAudioMuted = false;
let isHandRaised = false;
let myName = "User-" + Math.floor(Math.random() * 1000);
let meetingStartTime = null;
let meetingTimerInterval = null;

// Recording
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// 1. Initialization
function init() {
    // Clock
    setInterval(() => {
        const now = new Date();
        document.getElementById('room-time').innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 1000);

    // Event Listeners
    btnCreateMeeting.addEventListener('click', createMeeting);
    btnJoinMeeting.addEventListener('click', joinMeeting);
    btnCopyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(displayMeetingCode.innerText);
        showToast("Meeting code copied!");
    });

    btnToggleMic.addEventListener('click', toggleAudio);
    btnToggleVideo.addEventListener('click', toggleVideo);
    btnShareScreen.addEventListener('click', toggleScreenShare);
    btnLeave.addEventListener('click', leaveMeeting);
    btnRaiseHand.addEventListener('click', toggleHandRaise);
    btnToggleSidebar.addEventListener('click', () => {
        sidebar.classList.toggle('hidden');
        btnToggleSidebar.classList.toggle('active');
    });

    // Chat
    btnSendChat.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') sendChatMessage();
    });

    // Tabs
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });
}

// 2. Setup Peer
function initPeerJS(onOpenCallback) {
    // Create random ID for peer. Host will just use this ID as meeting code.
    myPeer = new Peer({
        config: {'iceServers': [
            { url: 'stun:stun.l.google.com:19302' },
            { url: 'stun:stun1.l.google.com:19302' }
        ]}
    });

    myPeer.on('open', id => {
        myPeerId = id;
        onOpenCallback(id);
    });

    // Handle Incoming WebRTC Connections (Data for chat/signaling)
    myPeer.on('connection', conn => {
        handleIncomingConnection(conn);
    });

    // Handle Incoming Media Calls
    myPeer.on('call', call => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            if(!localStream) {
                localStream = stream;
                addVideoStream(createVideoElement(myPeerId, true), stream, myPeerId, myName);
            }
            // Answer with our stream
            call.answer(localStream);
            const callerName = call.metadata ? call.metadata.name : "Peer";
            
            call.on('stream', remoteStream => {
                if(!document.getElementById(`video-wrapper-${call.peer}`)) {
                    addVideoStream(createVideoElement(call.peer, false), remoteStream, call.peer, callerName);
                }
            });

            roomPeers[call.peer] = { ...roomPeers[call.peer], call };
        });
    });

    myPeer.on('error', err => {
        console.error(err);
        showToast("Connection Error: " + err.type, 'error');
    });
}

// 3. Meeting Flows
async function createMeeting() {
    if (inputUsername.value.trim()) myName = inputUsername.value.trim();
    isHost = true;
    hostBadge.style.display = 'inline-block';
    btnRecord.style.display = 'flex'; // show record to host
    btnRecord.addEventListener('click', toggleRecording);
    
    // Get Local Media first
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        initPeerJS((id) => {
            hostId = id; // the host's id is the meeting code
            enterRoom(id);
        });
    } catch (err) {
        showToast("Camera/Mic permission denied.", "error");
    }
}

async function joinMeeting() {
    if (inputUsername.value.trim()) myName = inputUsername.value.trim();
    const code = inputMeetingCode.value.trim();
    if(!code) return showToast("Please enter a meeting code.", "error");
    
    isHost = false;
    hostId = code;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        initPeerJS((id) => {
            enterRoom(code);
            connectToPeer(code); // Connect to the host
        });
    } catch (err) {
        showToast("Camera/Mic permission denied.", "error");
    }
}

function enterRoom(code) {
    displayMeetingCode.innerText = code;
    landingPage.classList.remove('active');
    roomPage.classList.add('active');
    
    // Show my video
    addVideoStream(createVideoElement(myPeerId, true), localStream, myPeerId, myName + " (You)");
    
    // Start timers
    meetingStartTime = Date.now();
    meetingTimerInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - meetingStartTime) / 1000);
        const hrs = Math.floor(diff / 3600).toString().padStart(2, '0');
        const mins = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        document.getElementById('meeting-timer').innerText = `${hrs}:${mins}:${secs}`;
        
        // Host update participants view
        if(isHost) renderParticipants();
    }, 1000);

    // Initial participant list render
    renderParticipants();
}

// 4. Peer Connections & Signaling
function connectToPeer(peerId) {
    if(peerId === myPeerId) return;

    // Open data connection
    const conn = myPeer.connect(peerId, { metadata: { name: myName } });
    
    conn.on('open', () => {
        roomPeers[peerId] = { conn, joinTime: Date.now(), isHandRaised: false };
        if(isHost) {
            // Tell this new peer about other peers
            const others = Object.keys(roomPeers).filter(id => id !== peerId);
            conn.send({ type: 'peer-list', peers: others });
            showToast(`Someone joined the meeting.`);
            renderParticipants();
        } else {
            // Ask host to introduce us
            conn.send({ type: 'hello', name: myName });
        }

        // Call them with media
        const call = myPeer.call(peerId, localStream, { metadata: { name: myName } });
        call.on('stream', remoteStream => {
            if(!document.getElementById(`video-wrapper-${peerId}`)) {
                addVideoStream(createVideoElement(peerId, false), remoteStream, peerId, "Participant");
            }
        });
        
        call.on('close', () => {
            removeVideo(peerId);
        });

        roomPeers[peerId].call = call;
    });

    handleIncomingConnection(conn);
}

function handleIncomingConnection(conn) {
    conn.on('data', data => {
        if(data.type === 'peer-list') {
            // Connect to other peers in room (Full mesh topology)
            data.peers.forEach(p => {
                if(!roomPeers[p] && p !== myPeerId) connectToPeer(p);
            });
        }
        else if (data.type === 'chat') {
            appendMessage(data.name, data.message, false);
        }
        else if (data.type === 'raised-hand') {
            const wrapper = document.getElementById(`video-wrapper-${conn.peer}`);
            if(data.raised) {
                showToast(`${data.name} raised hand!`);
                if(wrapper) {
                    const badge = document.createElement('div');
                    badge.className = 'hand-raised-badge material-symbols-rounded';
                    badge.id = `hand-${conn.peer}`;
                    badge.innerText = 'front_hand';
                    wrapper.appendChild(badge);
                }
                if(roomPeers[conn.peer]) roomPeers[conn.peer].isHandRaised = true;
            } else {
                if(wrapper) {
                    const el = document.getElementById(`hand-${conn.peer}`);
                    if(el) el.remove();
                }
                if(roomPeers[conn.peer]) roomPeers[conn.peer].isHandRaised = false;
            }
            renderParticipants();
        }
        else if (data.type === 'request-mute' && !isHost) {
            // Host is requesting us to mute
            if(!isAudioMuted) {
                toggleAudio();
                showToast("The Host has muted your microphone.", "error");
            }
        }
    });

    conn.on('close', () => {
        removeVideo(conn.peer);
        delete roomPeers[conn.peer];
        if(isHost) {
            showToast("Someone left the meeting.");
            renderParticipants();
        }
    });

    if(!roomPeers[conn.peer]) {
        roomPeers[conn.peer] = { conn, joinTime: Date.now(), name: conn.metadata?.name || 'Peer' };
    } else {
        roomPeers[conn.peer].conn = conn;
        roomPeers[conn.peer].name = conn.metadata?.name || 'Peer';
    }
}

function broadcastData(data) {
    Object.values(roomPeers).forEach(p => {
        if(p.conn && p.conn.open) p.conn.send(data);
    });
}

// 5. Media & UI Functions
function createVideoElement(id, isLocal) {
    const wrapper = document.createElement('div');
    wrapper.className = `video-wrapper ${isLocal ? 'local-video' : 'remote-video'}`;
    wrapper.id = `video-wrapper-${id}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal; // Mute local playback to avoid echo
    wrapper.appendChild(video);

    const label = document.createElement('div');
    label.className = 'video-label';
    label.id = `label-${id}`;
    wrapper.appendChild(label);

    return wrapper;
}

function addVideoStream(wrapper, stream, id, labelText) {
    videoGrid.appendChild(wrapper);
    const video = wrapper.querySelector('video');
    video.srcObject = stream;
    
    const label = wrapper.querySelector('.video-label');
    label.innerText = labelText || "Unknown";
    updateGridSize();
}

function removeVideo(id) {
    const el = document.getElementById(`video-wrapper-${id}`);
    if(el) el.remove();
    updateGridSize();
}

function updateGridSize() {
    const count = videoGrid.children.length;
    let cols = 1;
    if(count > 1) cols = 2;
    if(count > 4) cols = 3;
    if(count > 9) cols = 4;
    videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    peopleCount.innerText = count;
}

function toggleAudio() {
    if(!localStream) return;
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    
    if(isAudioMuted) {
        btnToggleMic.classList.add('off');
        btnToggleMic.innerHTML = `<span class="material-symbols-rounded icon">mic_off</span>`;
    } else {
        btnToggleMic.classList.remove('off');
        btnToggleMic.innerHTML = `<span class="material-symbols-rounded icon">mic</span>`;
    }
}

function toggleVideo() {
    if(!localStream) return;
    isVideoMuted = !isVideoMuted;
    localStream.getVideoTracks()[0].enabled = !isVideoMuted;
    
    if(isVideoMuted) {
        btnToggleVideo.classList.add('off');
        btnToggleVideo.innerHTML = `<span class="material-symbols-rounded icon">videocam_off</span>`;
    } else {
        btnToggleVideo.classList.remove('off');
        btnToggleVideo.innerHTML = `<span class="material-symbols-rounded icon">videocam</span>`;
    }
}

async function toggleScreenShare() {
    if(screenStream) {
        // Stop sharing
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        
        // Replace tracks back to camera
        const videoTrack = localStream.getVideoTracks()[0];
        Object.values(roomPeers).forEach(p => {
            if(p.call && p.call.peerConnection) {
                const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if(sender) sender.replaceTrack(videoTrack);
            }
        });
        
        document.getElementById(`video-wrapper-${myPeerId}`).classList.remove('screen-share');
        btnShareScreen.classList.remove('active');
    } else {
        // Start sharing
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace tracks for peers
            Object.values(roomPeers).forEach(p => {
                if(p.call && p.call.peerConnection) {
                    const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if(sender) sender.replaceTrack(screenTrack);
                }
            });
            
            // Change local preview to local screen
            const localVideo = document.getElementById(`video-wrapper-${myPeerId}`).querySelector('video');
            localVideo.srcObject = screenStream;
            document.getElementById(`video-wrapper-${myPeerId}`).classList.add('screen-share');
            btnShareScreen.classList.add('active');

            // Handle stop from browser UI
            screenTrack.onended = () => {
                toggleScreenShare(); // revert
                localVideo.srcObject = localStream;
            };

        } catch (e) {
            console.error(e);
        }
    }
}

function toggleHandRaise() {
    isHandRaised = !isHandRaised;
    btnRaiseHand.classList.toggle('active', isHandRaised);
    
    // Add badge to local video
    const wrapper = document.getElementById(`video-wrapper-${myPeerId}`);
    if(isHandRaised) {
        const badge = document.createElement('div');
        badge.className = 'hand-raised-badge material-symbols-rounded';
        badge.id = `hand-${myPeerId}`;
        badge.innerText = 'front_hand';
        if(wrapper) wrapper.appendChild(badge);
    } else {
        const el = document.getElementById(`hand-${myPeerId}`);
        if(el) el.remove();
    }
    
    broadcastData({ type: 'raised-hand', raised: isHandRaised, name: myName });
}

function sendChatMessage() {
    const text = chatInput.value.trim();
    if(!text) return;
    
    appendMessage("You", text, true);
    broadcastData({ type: 'chat', message: text, name: myName });
    chatInput.value = '';
}

function appendMessage(sender, text, isSelf) {
    const msg = document.createElement('div');
    msg.className = `message ${isSelf ? 'self' : ''}`;
    msg.innerHTML = `
        <div class="msg-header">${sender}</div>
        <div class="msg-text">${text}</div>
    `;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function leaveMeeting() {
    if(myPeer) myPeer.destroy();
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    if(screenStream) screenStream.getTracks().forEach(t => t.stop());
    clearInterval(meetingTimerInterval);
    window.location.reload();
}

// 6. Host Features
function renderParticipants() {
    participantsList.innerHTML = `
        <div class="participant-item">
            <div class="p-info">
                <div class="p-avatar">${myName.charAt(0)}</div>
                <div class="p-details">
                    <span class="p-name">${myName} (You)</span>
                    <span class="p-time">Host</span>
                </div>
            </div>
        </div>
    `;

    Object.keys(roomPeers).forEach(id => {
        const p = roomPeers[id];
        const joinTimeStr = p.joinTime ? getDurationString(p.joinTime) : "Unknown";
        
        const el = document.createElement('div');
        el.className = 'participant-item';
        el.innerHTML = `
            <div class="p-info">
                <div class="p-avatar">${p.name ? p.name.charAt(0) : '?'}</div>
                <div class="p-details">
                    <span class="p-name">${p.name || id} ${p.isHandRaised ? '✋' : ''}</span>
                    <span class="p-time">${isHost ? 'Time: '+joinTimeStr : 'Participant'}</span>
                </div>
            </div>
            ${isHost ? `<div class="p-actions"><button class="btn text" onclick="requestMute('${id}')">Mute</button></div>` : ''}
        `;
        participantsList.appendChild(el);
    });
}

function getDurationString(startTimeMs) {
    const seconds = Math.floor((Date.now() - startTimeMs) / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

window.requestMute = function(peerId) {
    if(roomPeers[peerId] && roomPeers[peerId].conn) {
        roomPeers[peerId].conn.send({ type: 'request-mute' });
        showToast("Requested participant to mute.", "success");
    }
}

// Recording Meeting (Host)
function toggleRecording() {
    if(!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

function startRecording() {
    isRecording = true;
    recordedChunks = [];
    document.getElementById('recording-indicator').style.display = 'flex';
    btnRecord.classList.add('danger');
    
    // We'll record the host's screen & audio (as mixing all streams requires Canvas)
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(stream => {
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = e => {
            if(e.data.size > 0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.style = 'display: none';
            a.href = url;
            a.download = `meeting_recording_${new Date().getTime()}.webm`;
            a.click();
            URL.revokeObjectURL(url);
            stream.getTracks().forEach(t => t.stop());
            
            isRecording = false;
            document.getElementById('recording-indicator').style.display = 'none';
            btnRecord.classList.remove('danger');
        };
        
        mediaRecorder.start();
        showToast("Recording started.");
    }).catch(err => {
        isRecording = false;
        document.getElementById('recording-indicator').style.display = 'none';
        btnRecord.classList.remove('danger');
        showToast("Recording cancelled.", "error");
    });
}

function stopRecording() {
    if(mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        showToast("Recording saved.");
    }
}

// 7. Utilities
function showToast(msg, type='info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    let icon = 'info';
    if(type === 'error') icon = 'error';
    if(type === 'success') icon = 'check_circle';
    
    toast.innerHTML = `<span class="material-symbols-rounded" style="color: ${type==='error'?'var(--danger)':'var(--accent)'}">${icon}</span> ${msg}`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Bootstrap
init();
