#![cfg(test)]
use super::*;
use ark_bls12_381::{Fq, Fq2};
use ark_serialize::CanonicalSerialize;
use core::str::FromStr;
use soroban_sdk::testutils::Address as TestAddress;
use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    symbol_short, vec, Address, Bytes, BytesN, Env, String, U256,
};

// Mock token contract for testing
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn initialize(env: &Env, admin: Address, decimal: u32, name: String, symbol: String) {
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &admin);
        env.storage()
            .instance()
            .set(&symbol_short!("decimal"), &decimal);
        env.storage().instance().set(&symbol_short!("name"), &name);
        env.storage()
            .instance()
            .set(&symbol_short!("symbol"), &symbol);
    }

    pub fn mint(env: &Env, to: Address, amount: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap();
        admin.require_auth();

        let current_balance = env.storage().instance().get(&to).unwrap_or(0);
        env.storage()
            .instance()
            .set(&to, &(current_balance + amount));
    }

    pub fn balance(env: &Env, id: Address) -> i128 {
        env.storage().instance().get(&id).unwrap_or(0)
    }

    pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        let from_balance = env.storage().instance().get(&from).unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let to_balance = env.storage().instance().get(&to).unwrap_or(0);
        env.storage()
            .instance()
            .set(&from, &(from_balance - amount));
        env.storage().instance().set(&to, &(to_balance + amount));
    }
}

fn g1_from_coords(env: &Env, x: &str, y: &str) -> G1Affine {
    let ark_g1 = ark_bls12_381::G1Affine::new(Fq::from_str(x).unwrap(), Fq::from_str(y).unwrap());
    let mut buf = [0u8; G1_SERIALIZED_SIZE];
    ark_g1.serialize_uncompressed(&mut buf[..]).unwrap();
    G1Affine::from_array(env, &buf)
}

fn g2_from_coords(env: &Env, x1: &str, x2: &str, y1: &str, y2: &str) -> G2Affine {
    let x = Fq2::new(Fq::from_str(x1).unwrap(), Fq::from_str(x2).unwrap());
    let y = Fq2::new(Fq::from_str(y1).unwrap(), Fq::from_str(y2).unwrap());
    let ark_g2 = ark_bls12_381::G2Affine::new(x, y);
    let mut buf = [0u8; G2_SERIALIZED_SIZE];
    ark_g2.serialize_uncompressed(&mut buf[..]).unwrap();
    G2Affine::from_array(env, &buf)
}

fn test_commitment(env: &Env) -> BytesN<32> {
    BytesN::from_array(
        env,
        &[
            0x1d, 0x8c, 0xe4, 0xc4, 0x49, 0x5b, 0x5e, 0x34, 0x2a, 0xff, 0x61, 0x2e, 0x76, 0xb8,
            0x32, 0x29, 0x49, 0x71, 0x3e, 0xb3, 0x9c, 0x0c, 0xa5, 0xbc, 0xe9, 0x98, 0xa5, 0xb3,
            0xcf, 0xe4, 0x15, 0xb9,
        ],
    )
}

fn test_association_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(
        env,
        &[
            0x41, 0x25, 0x34, 0xa2, 0xe9, 0xa7, 0x85, 0x3c, 0x11, 0x8c, 0xc6, 0x0c, 0x9f, 0x0e,
            0x2c, 0x7c, 0x9e, 0x56, 0x9b, 0x23, 0x87, 0x46, 0x79, 0x9c, 0xc3, 0xb4, 0xaf, 0xd8,
            0x67, 0x4b, 0x3e, 0x72,
        ],
    )
}

fn test_recipient(env: &Env) -> Address {
    Address::from_string(&String::from_str(
        env,
        "GAGRIGZCFEYDOPSFJRJVUYLIN53H3BELSKM2BJ5OWW6MHSWR3DP6NEHL",
    ))
}

fn init_vk(env: &Env) -> Bytes {
    let vk = VerificationKey {
        alpha: g1_from_coords(env, "927341188260013616574853185898561726568613395913854588927604954969096262378259678027131216778306785873028629205017", "3070123395880844486230643469920125439818797576783486794184978705617904400595773070461146891915200624066770752239301"),
        beta: g2_from_coords(env, "3606228537388419908910503731121434271985986325783350278327810347603965962298622199795954626457892754735118434294706", "3273095258705896143294864472251173142853039271420450497226930313886470259982257547209322364452056146442118704908278", "3069056269062894294885096010984743174149719880340647572146519521810855339227572337381167390681619484556164111644563", "3026898264267563570356953177387805050934099489436130596814778851251015212489332174008962152919788299385907200686823"),
        gamma: g2_from_coords(env, "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160", "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758", "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905", "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582"),
        delta: g2_from_coords(env, "514377201294391085865356740012761039568667905550240239329103618062359691191954454779856550339555542644130722183052", "2650110605856605181259489377353447480027334824941631979057232802991818440648176708741961601369792261507637467997865", "108156346376755903063915503776407015479749444686449895422569412105898110216388769948237481601596039322011942533004", "2907176956754975741421716234783315982267737411234993551888176032845848248151311822920985531650637769134661277175617"),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(env, "950380084615233020516049349515578566742159447332287093581855732722177127002577052381270684045283590910932482850936", "555394492154086299851594550088060473900169436755054891445126819021998574906352967934464961471019005283660474443294"),
                g1_from_coords(env, "3997145013233198027275371230147764185138362053327437518507926670701107413101384302161362943516839034184951252278383", "2170445312355038895258308381310792180877874515165160359582979567409639386678470004789315193915647123305992907310334"),
                g1_from_coords(env, "1811331416039558440457371578394796998581762626775595442869048512992361376842881504318285322227104377146561915486619", "2555869269063681811216011553134646017205040098902565488588345795071495094820420754014776576892458628373862618027056"),
                g1_from_coords(env, "1729360931975081245648256649754603898882628927406301833989591841127356929012709403028532322857731470402144145923432", "839147341452245169138832759126845930561287328479131843556371492237922190092695897890735879286988612441004640771859"),
                g1_from_coords(env, "1870219126019063086876808867399033874101367712251204976713659360069468844377477453729771571368567478623672803999539", "1621722767805602971773417955403574017301796746431494691182014938614548297193103520301037011449032576183212899610141"),
                g1_from_coords(env, "716847949899336073836809765961155238384889446924150123430042885682338416657744479291609137528897320578522904818815", "832035177099474722801643052022637265073840684350370140451253847683451865997284500981228236566491943454742325803566"),
                g1_from_coords(env, "2648790644738698460581675615830610304448811849868043946107612071294589323472633632373276933720599520265954306258181", "2173858535697512736327033791268997014824520933373783222387316099724849221647269801274377932644845989093446274501905"),
                g1_from_coords(env, "1116964987565288438513118656870310386750429513279894768333700755861806541272236870930312092460189219017667347779327", "126694785889128678870018639464962810787612695172244920980530860628749532298751837408808302093779548768940924852283"),
            ],
        ),
    };

    return vk.to_bytes(env);
}

fn init_proof(env: &Env) -> Bytes {
    let proof = Proof {
        a: g1_from_coords(env, "95010517405837349723580531200892839481774629123272712004246708528741126305631316353823894623433353065187431495291", "2614268847503544575065356501208696878779091974890917340167361707616623910278261520567118814818764599019328070668231"),
        b: g2_from_coords(env, "659026321434636641199962072870925688841054584932141337484476142494461011170023734391177740141853703091837437888566", "3563768107486946951563792481440392851908496983047867233852995345806498350007021347444054346457399839741793072361068", "3461562088521093777623101629393274648130006352903534298628733219781203846760783559007638615354773050086464854738309", "652643969552544700716327472558502248917047245623839728153782720048203583632661308375213989718516634369431305955533"),
        c: g1_from_coords(env, "1867460824370960453256326806442026114444057602378749864401154412209741690689897962697639252588631389444266297643131", "2288401485984245117793145641750134507227968478013538015030409864367252095605632428828953857926441197306550538298968"),
    };

    return proof.to_bytes(env);
}

fn init_pub_signals(env: &Env) -> Bytes {
    let public_0 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x5f, 0x7d, 0x6c, 0x94, 0xdc, 0xe2, 0xc6, 0x00, 0x65, 0xcb, 0x42, 0x7e, 0x70, 0x65,
                0x48, 0x8b, 0x2e, 0xa8, 0x25, 0xff, 0x13, 0x7b, 0x1c, 0x07, 0xa8, 0x8b, 0x52, 0xcb,
                0xa1, 0x7f, 0x39, 0xfd,
            ],
        ),
    ); // nullifier
    let public_1 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x3b, 0x9a, 0xca, 0x00,
            ],
        ),
    ); // withdrawn value
    let public_2 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x10, 0x25, 0x5f, 0x41, 0x5c, 0x29, 0x77, 0x73, 0x28, 0x48, 0x34, 0x48, 0xdd, 0xf0,
                0xa1, 0xe9, 0xed, 0x10, 0x53, 0xd8, 0x3a, 0x13, 0xf0, 0xf9, 0x38, 0xcc, 0xf5, 0x45,
                0xea, 0x4b, 0x41, 0x43,
            ],
        ),
    ); // state root
    let public_3 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x41, 0x25, 0x34, 0xa2, 0xe9, 0xa7, 0x85, 0x3c, 0x11, 0x8c, 0xc6, 0x0c, 0x9f, 0x0e,
                0x2c, 0x7c, 0x9e, 0x56, 0x9b, 0x23, 0x87, 0x46, 0x79, 0x9c, 0xc3, 0xb4, 0xaf, 0xd8,
                0x67, 0x4b, 0x3e, 0x72,
            ],
        ),
    ); // association root
    let public_4 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x1f, 0xe4, 0x2c, 0xe7, 0xbf, 0x7e, 0x35, 0x25, 0x4a, 0xfb, 0x4a, 0x46, 0x3a, 0x0b,
                0xa9, 0x4e, 0xd1, 0xdc, 0xa2, 0x14, 0xeb, 0xfd, 0x08, 0xe9, 0x58, 0x03, 0xc1, 0xf4,
                0x94, 0xa0, 0xcf, 0x78,
            ],
        ),
    ); // recipient
    let public_5 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
            ],
        ),
    ); // relayer
    let public_6 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
            ],
        ),
    ); // fee

    let output = Vec::from_array(
        &env,
        [
            Fr::from_u256(public_0),
            Fr::from_u256(public_1),
            Fr::from_u256(public_2),
            Fr::from_u256(public_3),
            Fr::from_u256(public_4),
            Fr::from_u256(public_5),
            Fr::from_u256(public_6),
        ],
    );

    let pub_signals = PublicSignals {
        pub_signals: output,
    };

    return pub_signals.to_bytes(env);
}

fn init_erronous_pub_signals(env: &Env) -> Bytes {
    let public_0 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x5f, 0x7d, 0x6c, 0x94, 0xdc, 0xe2, 0xc6, 0x00, 0x65, 0xcb, 0x42, 0x7e, 0x70, 0x65,
                0x48, 0x8b, 0x2e, 0xa8, 0x25, 0xff, 0x13, 0x7b, 0x1c, 0x07, 0xa8, 0x8b, 0x52, 0xcb,
                0xa1, 0x7f, 0x39, 0xfd,
            ],
        ),
    ); // nullifier
    let public_1 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x3b, 0x9a, 0xca, 0x00,
            ],
        ),
    ); // withdrawn value
    let public_2 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x10, 0x25, 0x5f, 0x41, 0x5c, 0x29, 0x77, 0x73, 0x28, 0x48, 0x34, 0x48, 0xdd, 0xf0,
                0xa1, 0xe9, 0xed, 0x10, 0x53, 0xd8, 0x3a, 0x13, 0xf0, 0xf9, 0x38, 0xcc, 0xf5, 0x45,
                0xea, 0x4b, 0x41, 0x42,
            ],
        ),
    ); // state root
    let public_3 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x41, 0x25, 0x34, 0xa2, 0xe9, 0xa7, 0x85, 0x3c, 0x11, 0x8c, 0xc6, 0x0c, 0x9f, 0x0e,
                0x2c, 0x7c, 0x9e, 0x56, 0x9b, 0x23, 0x87, 0x46, 0x79, 0x9c, 0xc3, 0xb4, 0xaf, 0xd8,
                0x67, 0x4b, 0x3e, 0x72,
            ],
        ),
    ); // association root
    let public_4 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x1f, 0xe4, 0x2c, 0xe7, 0xbf, 0x7e, 0x35, 0x25, 0x4a, 0xfb, 0x4a, 0x46, 0x3a, 0x0b,
                0xa9, 0x4e, 0xd1, 0xdc, 0xa2, 0x14, 0xeb, 0xfd, 0x08, 0xe9, 0x58, 0x03, 0xc1, 0xf4,
                0x94, 0xa0, 0xcf, 0x78,
            ],
        ),
    ); // recipient
    let public_5 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
            ],
        ),
    ); // relayer
    let public_6 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
            ],
        ),
    ); // fee

    let output = Vec::from_array(
        &env,
        [
            Fr::from_u256(public_0),
            Fr::from_u256(public_1),
            Fr::from_u256(public_2),
            Fr::from_u256(public_3),
            Fr::from_u256(public_4),
            Fr::from_u256(public_5),
            Fr::from_u256(public_6),
        ],
    );

    let pub_signals = PublicSignals {
        pub_signals: output,
    };

    return pub_signals.to_bytes(env);
}

fn setup_test_environment(env: &Env) -> (Address, Address, Address) {
    // Deploy mock token
    let token_admin = Address::generate(env);
    let token_id = env.register(MockToken, ());
    let token_client = MockTokenClient::new(env, &token_id);

    // Initialize token
    token_client.initialize(
        &token_admin,
        &7u32,
        &String::from_str(env, "Test Token"),
        &String::from_str(env, "TEST"),
    );

    // Deploy privacy pools contract
    let admin = Address::generate(env);
    let privacy_pools_id = env.register(
        PrivacyPoolsContract,
        (init_vk(env), token_id.clone(), admin.clone()),
    );

    (token_id, privacy_pools_id, admin)
}

#[test]
fn test_deposit_and_withdraw_correct_proof() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env);
    env.cost_estimate().budget().print();

    // Create test addresses
    let alice = Address::generate(&env);
    let bob = test_recipient(&env);

    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    // Mint tokens to alice
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    // Test initial balance
    assert_eq!(client.get_balance(), 0);
    assert_eq!(token_client.balance(&alice), 1000000000);

    // Test deposit
    let commitment = test_commitment(&env);

    // Mock authentication for alice
    env.mock_all_auths();
    client.deposit(&alice, &commitment);

    // Check commitments
    let commitments = client.get_commitments();
    assert_eq!(commitments.len(), 1);
    assert_eq!(commitments.get(0).unwrap(), commitment);

    // Check balances after deposit
    assert_eq!(token_client.balance(&alice), 0); // Alice's balance should be 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should have the tokens

    // Set association root to match the proof
    let association_root = test_association_root(&env);
    env.mock_all_auths();
    let set_result = client.set_association_root(&admin, &association_root);
    assert_eq!(
        set_result,
        vec![&env, String::from_str(&env, SUCCESS_ASSOCIATION_ROOT_SET)]
    );

    // Test withdraw
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env);
    let pub_signals_struct = PublicSignals::from_bytes(&env, &pub_signals);
    let nullifier = pub_signals_struct.pub_signals.get(0).unwrap().to_bytes();

    let result = client.withdraw(&bob, &proof, &pub_signals);
    // Success is now logged as a diagnostic event, so we return an empty vec
    assert_eq!(result, vec![&env]);

    // Check balances after withdrawal
    assert_eq!(token_client.balance(&bob), 1000000000); // Bob should have the tokens
    assert_eq!(token_client.balance(&contract_id), 0); // Contract should have 0 tokens

    // Check nullifiers
    let nullifiers = client.get_nullifiers();
    assert_eq!(nullifiers.len(), 1);
    assert_eq!(nullifiers.get(0).unwrap(), nullifier);
}

#[test]
fn test_withdraw_wrong_recipient_rejected() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env);
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    let alice = Address::generate(&env);
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);
    client.deposit(&alice, &test_commitment(&env));
    client.set_association_root(&admin, &test_association_root(&env));

    let mallory = Address::generate(&env);
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env);

    let result = client.withdraw(&mallory, &proof, &pub_signals);
    assert_eq!(
        result,
        vec![&env, String::from_str(&env, ERROR_RECIPIENT_MISMATCH)]
    );

    assert_eq!(token_client.balance(&mallory), 0);
    assert_eq!(token_client.balance(&contract_id), 1000000000);
    assert_eq!(client.get_nullifiers().len(), 0);
}

#[test]
fn test_deposit_and_withdraw_wrong_proof() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env);

    // Create test addresses
    let alice = Address::generate(&env);
    let bob = test_recipient(&env);

    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    // Mint tokens to alice
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    // Test initial balance
    assert_eq!(client.get_balance(), 0);
    assert_eq!(token_client.balance(&alice), 1000000000);

    // Test deposit
    let commitment = test_commitment(&env);

    // Mock authentication for alice
    env.mock_all_auths();
    client.deposit(&alice, &commitment);

    // Check commitments
    let commitments = client.get_commitments();
    assert_eq!(commitments.len(), 1);
    assert_eq!(commitments.get(0).unwrap(), commitment);

    // Set association root to match the erroneous pub signals
    let association_root = test_association_root(&env);
    env.mock_all_auths();
    client.set_association_root(&admin, &association_root);

    // Test withdraw with wrong proof (different state root)
    let proof = init_proof(&env);
    let pub_signals = init_erronous_pub_signals(&env);

    let result = client.withdraw(&bob, &proof, &pub_signals);
    assert_eq!(
        result,
        vec![&env, String::from_str(&env, ERROR_COIN_OWNERSHIP_PROOF)]
    );

    // Check that balances are unchanged (withdrawal failed)
    assert_eq!(token_client.balance(&bob), 0); // Bob should still have 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should still have tokens

    let nullifiers = client.get_nullifiers();
    assert_eq!(nullifiers.len(), 0); // No nullifiers should be stored
}

#[test]
fn test_withdraw_insufficient_balance() {
    let env = Env::default();
    let (_token_id, contract_id, admin) = setup_test_environment(&env);
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);

    // Set association root to match the proof
    let association_root = test_association_root(&env);
    env.mock_all_auths();
    client.set_association_root(&admin, &association_root);

    let bob = test_recipient(&env);
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env);

    // Attempt to withdraw with zero balance
    env.mock_all_auths();
    let result = client.withdraw(&bob, &proof, &pub_signals);
    assert_eq!(
        result,
        vec![&env, String::from_str(&env, ERROR_INSUFFICIENT_BALANCE)]
    );

    // Ensure nullifier was not stored when withdrawal failed
    assert_eq!(client.get_nullifiers().len(), 0);
}

#[test]
fn test_reuse_nullifier() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env);
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    let alice = Address::generate(&env);
    let bob = test_recipient(&env);

    // Mint tokens to alice for the deposit
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    // Deposit
    let commitment = test_commitment(&env);
    env.mock_all_auths();
    client.deposit(&alice, &commitment);

    // Set association root to match the proof
    let association_root = test_association_root(&env);
    env.mock_all_auths();
    client.set_association_root(&admin, &association_root);

    // First withdraw - should succeed
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env);
    env.mock_all_auths();
    let result = client.withdraw(&bob, &proof, &pub_signals);
    assert_eq!(result, vec![&env]); // Should succeed

    // Verify the nullifier was stored
    let nullifiers = client.get_nullifiers();
    assert_eq!(nullifiers.len(), 1);

    // Attempt to reuse nullifier - should fail even though contract has no balance
    // The balance check comes first, so we need to add balance to reach the nullifier check
    env.mock_all_auths();
    token_client.mint(&contract_id, &1000000000); // Add balance directly to contract

    // Now try to withdraw again with the same proof
    env.mock_all_auths();
    let result = client.withdraw(&bob, &proof, &pub_signals);
    assert_eq!(
        result,
        vec![&env, String::from_str(&env, ERROR_NULLIFIER_USED)]
    );
}

#[test]
fn test_contract_initialization() {
    let env = Env::default();
    let (_token_id, contract_id, _admin) = setup_test_environment(&env);
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);

    // Test that contract initializes correctly
    let merkle_root = client.get_merkle_root();
    let merkle_depth = client.get_merkle_depth();
    let commitment_count = client.get_commitment_count();
    let commitments = client.get_commitments();
    let nullifiers = client.get_nullifiers();

    // Verify initial state
    assert_eq!(merkle_depth, 20);
    assert_eq!(commitment_count, 0);
    assert_eq!(commitments.len(), 0);
    assert_eq!(nullifiers.len(), 0);

    // Merkle root should be initialized (not all zeros)
    assert_ne!(merkle_root, BytesN::from_array(&env, &[0u8; 32]));
}

#[test]
#[should_panic(expected = "Association root must be set before withdrawal")]
fn test_withdraw_without_association_set() {
    let env = Env::default();
    let (token_id, contract_id, _admin) = setup_test_environment(&env);

    // Create test addresses
    let alice = Address::generate(&env);
    let bob = test_recipient(&env);

    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    // Mint tokens to alice
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    // Test initial balance
    assert_eq!(client.get_balance(), 0);
    assert_eq!(token_client.balance(&alice), 1000000000);

    // Test deposit - use the same commitment as in our proof
    let commitment = test_commitment(&env);

    // Mock authentication for alice
    env.mock_all_auths();
    client.deposit(&alice, &commitment);

    // Check commitments
    let commitments = client.get_commitments();
    assert_eq!(commitments.len(), 1);
    assert_eq!(commitments.get(0).unwrap(), commitment);

    // Check balances after deposit
    assert_eq!(token_client.balance(&alice), 0); // Alice's balance should be 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should have the tokens

    // Verify no association set is configured
    assert_eq!(client.has_association_set(), false);

    // Verify state before withdrawal attempt
    assert_eq!(token_client.balance(&bob), 0); // Bob should have 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should have tokens
    assert_eq!(client.get_nullifiers().len(), 0); // No nullifiers should be stored

    // Test withdraw with no association set configured
    // Since association root is now required, withdrawal should panic
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env);

    env.mock_all_auths();
    client.withdraw(&bob, &proof, &pub_signals);
}

#[test]
fn test_withdraw_association_root_mismatch() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env);

    // Create test addresses
    let alice = Address::generate(&env);
    let bob = test_recipient(&env);

    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    // Mint tokens to alice
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    // Test initial balance
    assert_eq!(client.get_balance(), 0);
    assert_eq!(token_client.balance(&alice), 1000000000);

    // Test deposit - use the same commitment as in our proof
    let commitment = test_commitment(&env);

    // Mock authentication for alice
    env.mock_all_auths();
    client.deposit(&alice, &commitment);

    // Check commitments
    let commitments = client.get_commitments();
    assert_eq!(commitments.len(), 1);
    assert_eq!(commitments.get(0).unwrap(), commitment);

    // Check balances after deposit
    assert_eq!(token_client.balance(&alice), 0); // Alice's balance should be 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should have the tokens

    // Set an incorrect association root (different from the one in the proof)
    let incorrect_association_root = BytesN::from_array(
        &env,
        &[
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0xff, 0xff,
        ],
    );
    env.mock_all_auths();
    let set_result = client.set_association_root(&admin, &incorrect_association_root);
    assert_eq!(
        set_result,
        vec![&env, String::from_str(&env, SUCCESS_ASSOCIATION_ROOT_SET)]
    );

    // Verify association set is configured
    assert_eq!(client.has_association_set(), true);

    // Test withdraw with proof that has a different association root
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env); // This has the correct association root for the proof

    let result = client.withdraw(&bob, &proof, &pub_signals);
    assert_eq!(
        result,
        vec![
            &env,
            String::from_str(&env, "Association set root mismatch")
        ]
    );

    // Check that balances are unchanged (withdrawal failed)
    assert_eq!(token_client.balance(&bob), 0); // Bob should still have 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should still have tokens

    // Check that no nullifier was stored when withdrawal failed
    let nullifiers = client.get_nullifiers();
    assert_eq!(nullifiers.len(), 0);
}

#[test]
fn test_set_association_root_non_admin() {
    let env = Env::default();
    let (_token_id, contract_id, _admin) = setup_test_environment(&env);
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);

    // Create a non-admin user
    let non_admin = Address::generate(&env);

    // Create a test association root
    let association_root = test_association_root(&env);

    // Mock authentication for the non-admin user
    env.mock_all_auths();

    // Attempt to call set_association_root with non-admin should return error
    let result = client.set_association_root(&non_admin, &association_root);

    // Verify that the call returned an error message
    assert_eq!(result, vec![&env, String::from_str(&env, ERROR_ONLY_ADMIN)]);

    // Verify that no association root was set (should still be zero)
    let stored_root = client.get_association_root();
    let zero_root = BytesN::from_array(&env, &[0u8; 32]);
    assert_eq!(
        stored_root, zero_root,
        "Association root should not be set by non-admin"
    );

    // Verify that has_association_set returns false
    assert_eq!(
        client.has_association_set(),
        false,
        "Should not have association set after failed non-admin call"
    );
}

#[test]
#[should_panic(expected = "Association root must be set before withdrawal")]
fn test_withdraw_requires_association_root() {
    let env = Env::default();
    let (token_id, contract_id, _admin) = setup_test_environment(&env);

    // Create test addresses
    let alice = Address::generate(&env);
    let bob = test_recipient(&env);

    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    // Mint tokens to alice
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    // Test deposit
    let commitment = test_commitment(&env);

    // Mock authentication for alice
    env.mock_all_auths();
    client.deposit(&alice, &commitment);

    // Check balances after deposit
    assert_eq!(token_client.balance(&alice), 0); // Alice's balance should be 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should have the tokens

    // Verify no association set is configured
    assert_eq!(client.has_association_set(), false);

    // Verify state before withdrawal attempt
    assert_eq!(token_client.balance(&bob), 0); // Bob should have 0
    assert_eq!(token_client.balance(&contract_id), 1000000000); // Contract should have tokens
    assert_eq!(client.get_nullifiers().len(), 0); // No nullifiers should be stored

    // Attempt to withdraw without setting association root - this should panic
    let proof = init_proof(&env);
    let pub_signals = init_pub_signals(&env);

    env.mock_all_auths();
    client.withdraw(&bob, &proof, &pub_signals);
}
