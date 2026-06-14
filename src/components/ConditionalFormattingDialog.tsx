import React, { useState } from 'react';
import { useAppConfig, VisualFilter } from '../data/configContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Trash2, Plus } from 'lucide-react';

export default function ConditionalFormattingDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const { config, updateConfig } = useAppConfig();
    
    // We will save VisualFilter[] into visualFilters.
    const [rules, setRules] = useState<VisualFilter[]>(config.visualFilters || []);

    const handleSave = () => {
        updateConfig({ visualFilters: rules });
        onOpenChange(false);
    };

    const addRule = () => {
        setRules([...rules, {
            id: Date.now().toString(),
            isActive: true,
            name: 'New Rule',
            matchType: 'event',
            matchValue: 'modifiedToday',
            rowTint: '',
            textColor: '',
            badgeColor: '',
            targetScope: ''
        }]);
    };

    const updateRule = (id: string, updates: Partial<VisualFilter>) => {
        setRules(rules.map(r => r.id === id ? { ...r, ...updates } : r));
    };

    const removeRule = (id: string) => {
        setRules(rules.filter(r => r.id !== id));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl bg-[#1e1e1e] border-[#333] text-gray-200 shadow-2xl overflow-y-auto max-h-[85vh]">
                <DialogHeader>
                    <DialogTitle className="text-white">Conditional Formatting Rules</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {rules.map((rule, idx) => (
                        <div key={rule.id} className="p-3 border border-[#333] bg-[#111] rounded space-y-3">
                            <div className="flex gap-3 items-center">
                                <div className="font-mono text-[10px] text-gray-500 w-4">#{idx+1}</div>
                                <input 
                                    className="h-8 bg-[#222] border border-[#444] rounded w-48 px-2 text-white text-xs outline-none focus:border-sky-500" 
                                    placeholder="Rule Name" 
                                    value={rule.name} 
                                    onChange={(e) => updateRule(rule.id, { name: e.target.value })} 
                                />
                                
                                <select 
                                    className="h-8 w-36 bg-[#222] border border-[#444] rounded text-white text-xs px-2 outline-none"
                                    value={rule.matchType} 
                                    onChange={(e: any) => updateRule(rule.id, { matchType: e.target.value, matchValue: '' })}
                                >
                                    <option value="event">Event / Timeframe</option>
                                    <option value="extension">Extension</option>
                                    <option value="regex">Regex Name</option>
                                    <option value="size">Size</option>
                                </select>

                                {rule.matchType === 'event' ? (
                                    <select 
                                        className="h-8 w-48 bg-[#222] border border-[#444] rounded text-white text-xs px-2 outline-none"
                                        value={rule.matchValue} 
                                        onChange={(e) => updateRule(rule.id, { matchValue: e.target.value })}
                                    >
                                        <option value="" disabled hidden>Select Event</option>
                                        <option value="modifiedToday">Modified Today</option>
                                        <option value="createdWithin24Hours">Created Within 24h</option>
                                        <option value="isReadOnly">Is Read-Only</option>
                                    </select>
                                ) : (
                                    <input 
                                        className="h-8 bg-[#222] border border-[#444] rounded w-48 px-2 text-white text-xs outline-none focus:border-sky-500" 
                                        placeholder={`Value for ${rule.matchType}`} 
                                        value={rule.matchValue} 
                                        onChange={(e) => updateRule(rule.id, { matchValue: e.target.value })} 
                                    />
                                )}
                                
                                <input 
                                    className="h-8 bg-[#222] border border-[#444] rounded flex-1 px-2 text-white text-xs outline-none focus:border-sky-500" 
                                    placeholder="Folder Scope (e.g. /C:/Windows)" 
                                    value={rule.targetScope || ''} 
                                    onChange={(e) => updateRule(rule.id, { targetScope: e.target.value })} 
                                />

                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-400/10" onClick={() => removeRule(rule.id)}>
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                            
                            <div className="flex gap-3 items-center pl-7 text-xs mt-2">
                                <span className="text-gray-400 w-16">Styles:</span>
                                <input 
                                    className="h-7 bg-[#222] border border-[#444] rounded px-2 w-32 text-xs text-white outline-none focus:border-sky-500" 
                                    placeholder="Text Color (HEX)" 
                                    value={rule.textColor || rule.hexColor || ''} 
                                    onChange={(e) => updateRule(rule.id, { textColor: e.target.value, hexColor: e.target.value })} 
                                />
                                <input 
                                    className="h-7 bg-[#222] border border-[#444] rounded px-2 w-36 text-xs text-white outline-none focus:border-sky-500" 
                                    placeholder="Row Tint (e.g. #ff00001a)" 
                                    value={rule.rowTint || ''} 
                                    onChange={(e) => updateRule(rule.id, { rowTint: e.target.value })} 
                                />
                                <input 
                                    className="h-7 bg-[#222] border border-[#444] rounded px-2 w-32 text-xs text-white outline-none focus:border-sky-500" 
                                    placeholder="Badge Dot Color" 
                                    value={rule.badgeColor || ''} 
                                    onChange={(e) => updateRule(rule.id, { badgeColor: e.target.value })} 
                                />
                            </div>
                        </div>
                    ))}
                    
                    <Button variant="outline" className="w-full border-dashed border-[#555] bg-transparent hover:bg-[#222] text-xs h-8" onClick={addRule}>
                        <Plus size={14} className="mr-2" /> Add Rule
                    </Button>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[#333]">
                    <Button variant="ghost" className="h-8 text-xs hover:bg-[#333]" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button className="h-8 text-xs bg-sky-600 hover:bg-sky-500 text-white" onClick={handleSave}>Save Ruleset</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
