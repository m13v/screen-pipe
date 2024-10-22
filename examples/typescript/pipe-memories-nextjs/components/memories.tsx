import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Memory {
  personal_information: {
    name: MemoryItem;
    age: MemoryItem;
    gender: MemoryItem;
    location: MemoryItem;
    address: MemoryItem;
    billing_address: MemoryItem;
    occupation: MemoryItem;
    contact_information: MemoryItem;
  };
  preferences_and_interests: {
    hobbies: MemoryItem;
    favorite_media: MemoryItem;
    communication_style: MemoryItem;
    dietary_preferences: MemoryItem;
  };
  social_and_professional_networks: {
    family_members: MemoryItem;
    friends: MemoryItem;
    colleagues: MemoryItem;
    social_media_profiles: MemoryItem;
  };
  goals_and_aspirations: {
    short_term_goals: MemoryItem;
    long_term_goals: MemoryItem;
    career_aspirations: MemoryItem;
    personal_development_plans: MemoryItem;
  };
  current_activities: {
    current_projects: MemoryItem;
    recent_events: MemoryItem;
    upcoming_appointments: MemoryItem;
    recent_communications: MemoryItem;
  };
  behavioral_patterns: {
    daily_routines: MemoryItem;
    sleep_patterns: MemoryItem;
    exercise_habits: MemoryItem;
    shopping_habits: MemoryItem;
  };
  emotional_and_psychological_state: {
    current_mood: MemoryItem;
    stress_levels: MemoryItem;
    recent_emotional_events: MemoryItem;
  };
  historical_context: {
    past_experiences: MemoryItem;
    major_life_events: MemoryItem;
    education_history: MemoryItem;
    work_history: MemoryItem;
  };
  digital_footprint: {
    frequently_visited_websites: MemoryItem;
    online_purchases: MemoryItem;
    search_history: MemoryItem;
  };
  security_and_privacy_settings: {
    data_sharing_preferences: MemoryItem;
    privacy_concerns: MemoryItem;
    security_questions: MemoryItem;
  };
}

interface MemoryItem {
  search_queries: Record<string, string>;
  apps_and_windows: string[];
}

export default function MemoriesList() {
    const [memories, setMemories] = useState<Memory | null>(null);

    useEffect(() => {
        async function fetchMemories() {
            try {
                const response = await fetch('/api/memories');
                if (!response.ok) {
                    throw new Error('failed to fetch memories');
                }
                const data = await response.json();
                setMemories(data);
            } catch (error) {
                console.error('error fetching memories:', error);
            }
        }

        fetchMemories();
    }, []);

    if (!memories) return <div>loading...</div>;

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">memories</h2>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>category</TableHead>
                        <TableHead>subcategory</TableHead>
                        <TableHead>search queries</TableHead>
                        <TableHead>apps and windows</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Object.entries(memories).map(([category, subcategories]) => (
                        Object.entries(subcategories).map(([subcategory, item]) => (
                            <TableRow key={`${category}-${subcategory}`}>
                                <TableCell>{category}</TableCell>
                                <TableCell>{subcategory}</TableCell>
                                <TableCell>
                                    {Object.entries(item.search_queries).map(([query, result]) => (
                                        <div key={query}><strong>{query}:</strong> {result}</div>
                                    ))}
                                </TableCell>
                                <TableCell>{item.apps_and_windows.join(', ')}</TableCell>
                            </TableRow>
                        ))
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
