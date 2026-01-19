export interface Ancestor {
    name: string;
    year: string;
    country: string;
    occupation: string;
}

export const ANCESTORS: Ancestor[] = [
    { name: 'Nasazzi', year: '1740', country: 'Uruguay', occupation: 'dominazione austriaca' },
    { name: 'Pensa', year: '1674', country: 'America', occupation: 'dominazione spagnola' },
    { name: 'Barindelli', year: '1700', country: 'Australia', occupation: 'dominazione austriaca' },
    { name: 'Maglia', year: '1620', country: 'Cina', occupation: 'dominazione spagnola' },
    { name: 'Bertarini', year: '1703', country: 'Russia', occupation: 'dominazione austriaca' },
    { name: 'Ferraroli', year: '1717', country: 'Grecia', occupation: 'dominazione spagnola' },
    { name: 'Viglienghi', year: '1790', country: 'Francia', occupation: 'dominazione austriaca' },
    { name: 'Acquistapace', year: '1720', country: 'Sud America', occupation: 'dominazione spagnola' },
    { name: 'Carissimo', year: '1750', country: 'Europa', occupation: 'dominazione austriaca' }, // Fallback/Extra
];

/*
* Determines the ancestor based on the player's position in the team (join order).
* - Creator (first member) -> Index 0 -> Nasazzi
* - Joiner 1 -> Index 1 -> Pensa
* - ...
*/
export const getAncestor = (currentSessionId: string | undefined, members: any[]) => {
    if (!currentSessionId || !members || members.length === 0) return ANCESTORS[0]; // Default to Nasazzi

    // Sort members by joinedAt to ensure consistent order
    const sortedMembers = [...members].sort((a, b) =>
        new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
    );

    const index = sortedMembers.findIndex(m => m.sessionId === currentSessionId);

    // Safety check: if not found, default to 0
    if (index === -1) return ANCESTORS[0];

    // Modulo to cycle if more than 9 players (unlikely but safe)
    return ANCESTORS[index % ANCESTORS.length];
};
