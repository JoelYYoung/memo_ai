import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Notice } from 'obsidian';
import { StoredPush, StoredPushMessage } from '../../pushTypes';
import { Chunk } from '../../ChunkManager';
import type MemoAIPlugin from '../../../main';
import { ChunkCard } from './ChunkCard';
import { StarRating5 } from './StarRating5';

interface PushCenterViewProps {
	plugin: MemoAIPlugin;
}

export const PushCenterViewComponent: React.FC<PushCenterViewProps> = ({ plugin }) => {
	const [pushes, setPushes] = useState<StoredPush[]>([]);
	const [selectedPushId, setSelectedPushId] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [messageInputs, setMessageInputs] = useState<Record<string, string>>({});
	const [manualGrades, setManualGrades] = useState<Record<string, number>>({});
	const [activeTab, setActiveTab] = useState<Record<string, 'manual' | 'ai'>>({});
	const [hasInteracted, setHasInteracted] = useState<Record<string, boolean>>({});
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
	const [isLoadingEnd, setIsLoadingEnd] = useState<Record<string, boolean>>({});
	const [evaluationMethod, setEvaluationMethod] = useState<Record<string, 'manual' | 'ai'>>({});

	const loadPushes = useCallback(() => {
		const allPushes = plugin.pushManager.getPushes('all');
		setPushes(allPushes);
		
		// If selected push was deleted, clear selection or select first available
		if (selectedPushId && !allPushes.find(p => p.id === selectedPushId)) {
			setSelectedPushId(allPushes.length > 0 ? allPushes[0].id : null);
		} else if (!selectedPushId && allPushes.length > 0) {
			setSelectedPushId(allPushes[0].id);
		}
	}, [plugin, selectedPushId]);

	useEffect(() => {
		loadPushes();
	}, [loadPushes]);

	useEffect(() => {
		const handler = () => loadPushes();
		plugin.pushManager.on('push-updated', handler);
		return () => {
			plugin.pushManager.off('push-updated', handler);
		};
	}, [plugin, loadPushes]);

	const handleRefresh = async () => {
		setIsRefreshing(true);
		try {
			const stats = await plugin.pushManager.refreshPushes();
			new Notice(
				`Pushes refreshed: ${stats.deleted} deleted, ${stats.created} created, ${stats.kept} kept`
			);
		} catch (e: any) {
			new Notice(`Failed to refresh pushes: ${e.message}`);
		} finally {
			setIsRefreshing(false);
		}
	};

	const handleStartConversation = async (pushId: string) => {
		setIsLoading(prev => ({ ...prev, [pushId]: true }));
		try {
			await plugin.pushManager.startConversation(pushId);
			loadPushes();
		} catch (e: any) {
			new Notice(`Failed to start push: ${e.message}`);
		} finally {
			setIsLoading(prev => ({ ...prev, [pushId]: false }));
		}
	};

	const handleSendMessage = async (pushId: string) => {
		const content = (messageInputs[pushId] || '').trim();
		if (!content) return;

		setIsLoading(prev => ({ ...prev, [pushId]: true }));
		setIsLoadingEnd(prev => ({ ...prev, [pushId]: false }));
		try {
			await plugin.pushManager.sendUserMessage(pushId, content);
			setMessageInputs(prev => ({ ...prev, [pushId]: '' }));
			loadPushes();
		} catch (e: any) {
			new Notice(`Failed to send message: ${e.message}`);
		} finally {
			setIsLoading(prev => ({ ...prev, [pushId]: false }));
		}
	};

	const handleForceEvaluate = async (pushId: string) => {
		setIsLoadingEnd(prev => ({ ...prev, [pushId]: true }));
		setIsLoading(prev => ({ ...prev, [pushId]: false }));
		try {
			await plugin.pushManager.forceAutoEvaluate(pushId);
			loadPushes();
		} catch (e: any) {
			new Notice(`Failed to finalize: ${e.message}`);
		} finally {
			setIsLoadingEnd(prev => ({ ...prev, [pushId]: false }));
		}
	};

	const handleManualEvaluate = async (pushId: string) => {
		const grade = manualGrades[pushId] ?? 3;
		try {
			await plugin.pushManager.manualEvaluate(pushId, grade);
			new Notice('Evaluation saved');
			loadPushes();
		} catch (e: any) {
			new Notice(`Failed to evaluate: ${e.message}`);
		}
	};

	const handleManualGradeChange = (pushId: string, grade: number) => {
		setManualGrades(prev => ({ ...prev, [pushId]: grade }));
	};

	const handleSubmitManualGrade = async (pushId: string) => {
		const grade = manualGrades[pushId] ?? 3;
		setIsLoading(prev => ({ ...prev, [pushId]: true }));
		try {
			await plugin.pushManager.manualEvaluate(pushId, grade);
			new Notice('Evaluation saved');
			setHasInteracted(prev => ({ ...prev, [pushId]: true }));
			setEvaluationMethod(prev => ({ ...prev, [pushId]: 'manual' }));
			loadPushes();
		} catch (e: any) {
			new Notice(`Failed to evaluate: ${e.message}`);
		} finally {
			setIsLoading(prev => ({ ...prev, [pushId]: false }));
		}
	};

	const handleStartConversationWithTab = async (pushId: string) => {
		setActiveTab(prev => ({ ...prev, [pushId]: 'ai' }));
		setHasInteracted(prev => ({ ...prev, [pushId]: true }));
		setEvaluationMethod(prev => ({ ...prev, [pushId]: 'ai' }));
		await handleStartConversation(pushId);
	};

	const handleDeletePush = async (pushId: string) => {
		if (confirm('Are you sure you want to delete this push?')) {
			await plugin.pushManager.deletePush(pushId);
			if (selectedPushId === pushId) {
				setSelectedPushId(null);
			}
			loadPushes();
		}
	};

	const handleToggleReview = async (chunk: Chunk) => {
		await plugin.chunkManager.updateChunk(chunk.id, { needsReview: !chunk.needsReview });
		// Trigger push update to sync
		plugin.pushManager.trigger('push-updated');
		loadPushes();
	};

	const handleChangeImportance = async (chunk: Chunk, newLevel: 'low' | 'medium' | 'high') => {
		if (chunk.importanceLevel !== newLevel) {
			await plugin.chunkManager.updateChunk(chunk.id, { importanceLevel: newLevel });
			// Trigger push update to sync
			plugin.pushManager.trigger('push-updated');
			loadPushes();
		}
	};

	const formatHoursFromNow = (timestamp?: number): string => {
		if (!timestamp) return 'N/A';
		const diff = timestamp - Date.now();
		const hours = Math.round(Math.abs(diff) / (1000 * 60 * 60));
		if (diff >= 0) {
			return `${hours}h`;
		}
		return `overdue ${hours}h`;
	};

	const formatHoursAgo = (timestamp?: number): string => {
		if (!timestamp) return 'unknown';
		const diff = Date.now() - timestamp;
		const hours = Math.max(0, Math.round(diff / (1000 * 60 * 60)));
		return `${hours}h ago`;
	};

	const formatExactDate = (timestamp?: number): string => {
		if (!timestamp) return 'unknown';
		const date = new Date(timestamp);
		if (isNaN(date.getTime())) return 'unknown';
		return date.toLocaleString();
	};

	const getFamiliarityColor = (percentage: number): string => {
		if (percentage < 30) return '#ff4d4f';
		if (percentage < 60) return '#faad14';
		if (percentage < 80) return '#52c41a';
		return '#1890ff';
	};

	const selectedPush = pushes.find(p => p.id === selectedPushId);
	const selectedChunk = selectedPush ? plugin.chunkManager.getChunk(selectedPush.chunkId) : null;
	const messages = selectedPush ? plugin.pushManager.getMessages(selectedPush.id) : [];

	return (
		<div className="ai-notebook-push-center">
			<div className="ai-notebook-push-header">
				<h2>Pushes ({pushes.length})</h2>
				<button onClick={handleRefresh} disabled={isRefreshing}>
					{isRefreshing ? 'Refreshing...' : 'Refresh Pushes'}
				</button>
			</div>

			<div className="ai-notebook-push-body">
				<button
					className={`ai-notebook-sidebar-toggle ${isSidebarCollapsed ? 'collapsed' : 'expanded'}`}
					onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
					aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					{isSidebarCollapsed ? '▶' : '◀'}
				</button>
				<div className={`ai-notebook-push-sidebar ${isSidebarCollapsed ? 'collapsed' : 'expanded'}`}>
					{!isSidebarCollapsed && (
						<div className="ai-notebook-push-list">
							{pushes.length === 0 ? (
								<p>No pushes scheduled yet.</p>
							) : (
									pushes.map(push => {
										const chunk = plugin.chunkManager.getChunk(push.chunkId);
										return (
											<div
												key={push.id}
												className={`ai-notebook-push-list-item ${selectedPushId === push.id ? 'active' : ''}`}
												onClick={() => {
													setSelectedPushId(push.id);
													setIsSidebarCollapsed(true);
												}}
											>
												<div className="ai-notebook-push-list-title">
													{chunk?.content?.slice(0, 60) || push.chunkId}
												</div>
											</div>
										);
									})
							)}
						</div>
					)}
				</div>

				{isSidebarCollapsed && (
					<div className="ai-notebook-push-detail">
					{!selectedPush ? (
						<p>Select a push from the list.</p>
					) : !selectedChunk ? (
						<p className="ai-notebook-warning">Chunk 数据已被删除，无法显示详细信息。</p>
					) : (
						<>
							{/* Push Info Box */}
							<div className="ai-notebook-push-info-box">
								<div className="ai-notebook-push-info-content">
									<div className="ai-notebook-push-info-row-single">
										<span className="ai-notebook-push-info-label">Due in:</span>
										<span className="ai-notebook-push-info-value">{formatHoursFromNow(selectedPush.expiresAt)}</span>
										<span className="ai-notebook-push-info-separator">•</span>
										<span className="ai-notebook-push-info-label">Created:</span>
										<span className="ai-notebook-push-info-value">{formatHoursAgo(selectedPush.createdAt)}</span>
									</div>
									<div className="ai-notebook-push-info-actions">
										{selectedChunk.notePath && (
											<button 
												className="ai-notebook-push-info-btn"
												onClick={() => plugin.openFileAtPath(selectedChunk.notePath)}
											>
												Open Note
											</button>
										)}
										<button 
											className="ai-notebook-push-info-btn mod-warning"
											onClick={() => handleDeletePush(selectedPush.id)}
										>
											Delete Push
										</button>
									</div>
								</div>
							</div>

							{/* Chunk Card */}
							<ChunkCard
								chunk={selectedChunk}
								showIndex={false}
								onToggleReview={handleToggleReview}
								onChangeImportance={handleChangeImportance}
								getFamiliarityColor={getFamiliarityColor}
								formatDate={formatExactDate}
							/>

							{selectedPush.state === 'pending' && (
								<div className="ai-notebook-push-evaluation-tabs">
									<div className="ai-notebook-push-tab-header">
										<button
											className={`ai-notebook-push-tab ${(activeTab[selectedPush.id] || 'manual') === 'manual' ? 'active' : ''} ${hasInteracted[selectedPush.id] && activeTab[selectedPush.id] !== 'manual' ? 'disabled' : ''}`}
											onClick={() => !hasInteracted[selectedPush.id] && setActiveTab(prev => ({ ...prev, [selectedPush.id]: 'manual' }))}
											disabled={hasInteracted[selectedPush.id] && activeTab[selectedPush.id] !== 'manual'}
										>
											Manual Grading
										</button>
										<button
											className={`ai-notebook-push-tab ${(activeTab[selectedPush.id] || 'manual') === 'ai' ? 'active' : ''} ${hasInteracted[selectedPush.id] && activeTab[selectedPush.id] !== 'ai' ? 'disabled' : ''}`}
											onClick={() => !hasInteracted[selectedPush.id] && setActiveTab(prev => ({ ...prev, [selectedPush.id]: 'ai' }))}
											disabled={hasInteracted[selectedPush.id] && activeTab[selectedPush.id] !== 'ai'}
										>
											AI Conversation
										</button>
									</div>
									<div className="ai-notebook-push-tab-content">
										{(activeTab[selectedPush.id] || 'manual') === 'manual' ? (
											<div className="ai-notebook-push-section ai-notebook-push-manual">
												<p>Choose a familiarity score (1-5 stars)</p>
												<div className="ai-notebook-manual-grade-container">
													<StarRating5
														value={manualGrades[selectedPush.id] ?? 3}
														onChange={(value) => handleManualGradeChange(selectedPush.id, value)}
													/>
													<button 
														className="ai-notebook-submit-grade-btn"
														onClick={() => handleSubmitManualGrade(selectedPush.id)}
													>
														Submit
													</button>
												</div>
											</div>
										) : (
											<div className="ai-notebook-push-section ai-notebook-push-ai">
												<h4>AI Conversation</h4>
												<p>Start a interactive review session with AI.</p>
												<div className="ai-notebook-start-conversation-wrapper">
													<button 
														onClick={() => handleStartConversationWithTab(selectedPush.id)}
														disabled={isLoading[selectedPush.id]}
														className={isLoading[selectedPush.id] ? 'loading' : ''}
													>
														{isLoading[selectedPush.id] ? 'Starting...' : 'Start AI Conversation'}
													</button>
												</div>
											</div>
										)}
									</div>
								</div>
							)}

							{selectedPush.state !== 'pending' && messages.length > 0 && evaluationMethod[selectedPush.id] !== 'manual' && (
								<div className="ai-notebook-push-section ai-notebook-push-ai">
									<h4>AI Conversation</h4>
									<div className="ai-notebook-push-messages">
										{messages.map((msg: StoredPushMessage) => (
											<div key={msg.id} className={`ai-notebook-push-message ${msg.sender}`}>
												<span>{msg.sender === 'user' ? 'You' : 'Tutor'}</span>
												<p>{msg.content}</p>
											</div>
										))}
									</div>

									{selectedPush.state === 'active' && (
										<div className="ai-notebook-push-input-container">
											<div className="ai-notebook-push-input-box">
												<textarea
													className="ai-notebook-push-input-textarea"
													placeholder="Type your response..."
													value={messageInputs[selectedPush.id] || ''}
													onChange={(e) => setMessageInputs(prev => ({ ...prev, [selectedPush.id]: e.target.value }))}
													onKeyDown={(e) => {
														if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
															void handleSendMessage(selectedPush.id);
														}
													}}
													disabled={isLoading[selectedPush.id] || isLoadingEnd[selectedPush.id]}
													rows={3}
												/>
												<button 
													className={`ai-notebook-push-send-btn ${isLoading[selectedPush.id] ? 'loading' : ''} ${isLoadingEnd[selectedPush.id] ? 'disabled' : ''}`}
													onClick={() => void handleSendMessage(selectedPush.id)}
													disabled={isLoading[selectedPush.id] || isLoadingEnd[selectedPush.id]}
													title="Send (Cmd/Ctrl + Enter)"
												>
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
														<line x1="22" y1="2" x2="11" y2="13"></line>
														<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
													</svg>
												</button>
											</div>
											<div className="ai-notebook-push-end-btn-wrapper">
												<button 
													className={`ai-notebook-push-end-btn ${isLoadingEnd[selectedPush.id] ? 'loading' : ''} ${isLoading[selectedPush.id] ? 'disabled' : ''}`}
													onClick={() => handleForceEvaluate(selectedPush.id)}
													disabled={isLoading[selectedPush.id] || isLoadingEnd[selectedPush.id]}
												>
													{isLoadingEnd[selectedPush.id] ? 'LLM evaluating...' : 'End Conversation'}
												</button>
											</div>
										</div>
									)}
								</div>
							)}

							{selectedPush.evaluation && (
								<div className="ai-notebook-push-evaluation">
									<h4>Evaluation</h4>
									<p>Grade: {selectedPush.evaluation.grade}</p>
									<p>{selectedPush.evaluation.recommendation}</p>
									{selectedPush.evaluation.nextDueAt && (
										<p>Next review: {new Date(selectedPush.evaluation.nextDueAt).toLocaleString()}</p>
									)}
								</div>
							)}

						</>
					)}
					</div>
				)}
			</div>
		</div>
	);
};

