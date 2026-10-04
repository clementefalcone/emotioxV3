import { Input } from '../ui/Input';
import { Autocomplete, type AutocompleteOption } from '../ui/Autocomplete';
import { type Enterprise } from '../../services/enterprises.service';

interface ResearchFormStep1Props {
    name: string;
    enterpriseName: string;
    enterpriseId: string;
    nameError?: string;
    enterpriseError?: string;
    enterprises: Enterprise[];
    loadingEnterprises: boolean;
    onNameChange: (value: string) => void;
    onEnterpriseChange: (value: string) => void;
    onEnterpriseSelect: (option: AutocompleteOption) => void;
    onCreateEnterprise?: (name: string) => Promise<void>;
}

export const ResearchFormStep1 = ({
    name,
    enterpriseName,
    nameError,
    enterpriseError,
    enterprises,
    loadingEnterprises,
    onNameChange,
    onEnterpriseChange,
    onEnterpriseSelect,
    onCreateEnterprise,
}: ResearchFormStep1Props) => {
    return (
        <div className="space-y-6">
            <Input
                id="researchName"
                label="Research Name"
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                error={nameError}
                placeholder="Enter research name"
                required
            />

            <div className="space-y-2">
                <Autocomplete
                    id="enterpriseId"
                    label="Enterprise"
                    value={enterpriseName}
                    onChange={onEnterpriseChange}
                    onSelect={onEnterpriseSelect}
                    onCreateNew={onCreateEnterprise}
                    error={enterpriseError}
                    placeholder={loadingEnterprises ? 'Loading...' : onCreateEnterprise ? 'Select or create Enterprise' : 'Select Enterprise'}
                    options={enterprises.map((enterprise) => ({
                        value: enterprise.id,
                        label: enterprise.name,
                    }))}
                    disabled={loadingEnterprises}
                    required
                    createNewLabel="Create new enterprise"
                />
            </div>
        </div>
    );
};
