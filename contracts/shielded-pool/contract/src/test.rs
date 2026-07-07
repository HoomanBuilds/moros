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

#[contract]
pub struct MockMarket;

#[contractimpl]
impl MockMarket {
    pub fn __constructor(env: Env, outcome: Option<Side>) {
        env.storage().instance().set(&symbol_short!("outcome"), &outcome);
        env.storage().instance().set(&symbol_short!("qy"), &0i128);
        env.storage().instance().set(&symbol_short!("qn"), &0i128);
    }
    pub fn outcome(env: Env) -> Option<Side> {
        env.storage()
            .instance()
            .get(&symbol_short!("outcome"))
            .unwrap_or(None)
    }
    pub fn set_token(env: Env, token: Address) {
        env.storage().instance().set(&symbol_short!("token"), &token);
    }
    pub fn quote_batch(_env: Env, dqyes: i128, dqno: i128) -> i128 {
        (dqyes + dqno) / 2
    }
    pub fn apply_batch(env: Env, batcher: Address, dqyes: i128, dqno: i128) -> i128 {
        let net = (dqyes + dqno) / 2;
        let token: Address = env.storage().instance().get(&symbol_short!("token")).unwrap();
        soroban_sdk::token::Client::new(&env, &token).transfer(
            &batcher,
            &env.current_contract_address(),
            &net,
        );
        let qy: i128 = env.storage().instance().get(&symbol_short!("qy")).unwrap_or(0);
        let qn: i128 = env.storage().instance().get(&symbol_short!("qn")).unwrap_or(0);
        env.storage().instance().set(&symbol_short!("qy"), &(qy + dqyes));
        env.storage().instance().set(&symbol_short!("qn"), &(qn + dqno));
        net
    }
    pub fn get_q(env: Env) -> (i128, i128) {
        (
            env.storage().instance().get(&symbol_short!("qy")).unwrap_or(0),
            env.storage().instance().get(&symbol_short!("qn")).unwrap_or(0),
        )
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
            0x70, 0x9f, 0x9c, 0x5a, 0xca, 0x88, 0xef, 0x30, 0x21, 0x82, 0x44, 0x01, 0xe8, 0x4f,
            0xc2, 0xef, 0xaf, 0x06, 0x7c, 0xa1, 0xcc, 0xa6, 0x7a, 0x00, 0x0d, 0x35, 0x89, 0x9b,
            0x4c, 0x4b, 0xd1, 0xc3,
        ],
    )
}

fn test_association_root(env: &Env) -> BytesN<32> {
    BytesN::from_array(
        env,
        &[
            0x69, 0x1d, 0xdd, 0x92, 0xbd, 0x66, 0x6d, 0x3a, 0x17, 0xfe, 0x16, 0x5b, 0x9e, 0x1c,
            0xd9, 0x25, 0xba, 0xfa, 0x92, 0xe6, 0x22, 0xbe, 0x9f, 0x46, 0xfa, 0xee, 0xbc, 0x95,
            0xb6, 0x5a, 0x8f, 0x5e,
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
        alpha: g1_from_coords(env, "498096176487216679327361136947535099636681698045067210078959885922834934566608391096040938452749016509772006336337", "2772211886376673709292937008866741277323116873472485433526706121510292956370840145929694541977921631755822954363395"),
        beta: g2_from_coords(env, "3688749396582217800728123824350218306928851687537166143507198041413976840866518788019990782664662680912130460652290", "3738402338172532271069588764590694875160982492775445449824188734757473923242973970365900004370874139638933996196988", "3977909346238777002102548710206455447003993585610055752631747771384033917905292544784757028839990468194866430785581", "306354319493681378568761503382884080258085025375612238548445348594744034427657423782595277482363188725313913404385"),
        gamma: g2_from_coords(env, "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160", "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758", "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905", "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582"),
        delta: g2_from_coords(env, "863458186170822258871648217643072496727550103093612375491750629350558712658394751619897820355982797382016652939510", "3151135504727299238156978508203134362744737081297043460868787073301567825164750755347932135591734013737727998974844", "680461897021101898610476270590143083214898537726238334947087827647935632900758269374639110610989895339463752123307", "1418994539445344953220521444476513662071927763341379306053874892236028439303743888936805252010909933371791088879244"),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(env, "1067173632635953615442394473917664268028754838901303475901953176529935001202783695786087827296269112265739453456953", "544029433293120413604861620869383199474092999890772039222367099177592594742381774937848166316447236906646340649227"),
                g1_from_coords(env, "1333554179502631590191261162191920865228648367993489998932463932899706310796069008273007073191971573504763413558224", "1545057225256716954198733008121933718881073931984686268438554499784811840224714072127312390357101191319517408313989"),
                g1_from_coords(env, "3123438879920464191731494738242576340172059273152463159302225906407449391092627089103838303484407911984149730660250", "989095507275124169938101998004421881616349338125714335674520947612787074620678811851001945065950892498857930497811"),
                g1_from_coords(env, "2332369829641502181642555449266608595119119760479093022599012179635946006237266292425633559936786236290999870342261", "1672586541299041468234428433605436865734294665292973200381490918715767570286022378196236440385474062686104123389240"),
                g1_from_coords(env, "3758866522926677045509840362584239698412588035652995401685453818909032740074626258147786143217757380326910809270287", "1370799538504310043963338679253002591485103374952781437405994715758246509802909823520918083401758294352276825480289"),
                g1_from_coords(env, "377452603926961930402136970195367135038152234711452887235578308990333293853497807398796149745799420329835792675414", "1179328927117161819836538601877679489138522186388221141372916091466433600974708335429284428823531367168832482312381"),
                g1_from_coords(env, "520872631426823846984481646363630957376183047675540612964387615679818237381501072698784937832841211935295571732936", "3830830699930859477287711363596439180006449756130710020294664211776763222804170609554832620245116008020425621615417"),
                g1_from_coords(env, "2422925150239622882610552326275975492180069540033988633845872768498914615320490300489420547293294664389924931444998", "2020713359052314402639152159762336135217456187733910395494395044284520393185309264081584600615820264564631711618317"),
                g1_from_coords(env, "2169489943393455203103589707016005615165128863291485210369018470049458907347858221552210675061359045957535490480212", "3297914066267142250981715993716904956717583188938019313466881374042278057583036647113931998395665736688414947841545"),
            ],
        ),
    };

    vk.to_bytes(env)
}

fn init_proof(env: &Env) -> Bytes {
    let proof = Proof {
        a: g1_from_coords(env, "2893228565645260290752843763048948623324617162854406599215082605774372015001687467581786879552520166458652153643721", "3218318000008800732991359353500889107056787299359112006915952528201232680488741792191088977375101899966133854804582"),
        b: g2_from_coords(env, "1825235391829827291941868521720307317347901318036308866089358167967540633521876155595186710558789136246338066100240", "3205388849229901657259024465410703577228445898201806479996889473269546690603786741561859413785493201933615759343260", "2481982444852712770525397582508197753001424895819697502701216182043765567431913947188929728705420095741413623850007", "427465173554109808278860634293135250292214262978683228167061234137955921950605220774588790315103712749357793384485"),
        c: g1_from_coords(env, "3302208671740608122413016565376569493053579330128131313207825923711304718583013155931673981294193567203484007970581", "2801250855256136457815166715924701895715122415266908478239698604971858009200333480612074141092696735344700498606887"),
    };

    proof.to_bytes(env)
}

fn init_pub_signals(env: &Env) -> Bytes {
    let public_0 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x41, 0x9e, 0x3d, 0xa0, 0x9a, 0x24, 0xb3, 0x5d, 0x01, 0x4f, 0x50, 0x11, 0xf0, 0xd1,
                0xd5, 0xe4, 0x68, 0xae, 0xb8, 0xe2, 0x8f, 0x57, 0x9d, 0xfe, 0xbf, 0x2f, 0x2e, 0xed,
                0x1c, 0x6e, 0x7a, 0xde,
            ],
        ),
    );
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
    );
    let public_2 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x42, 0xc0, 0x37, 0xe8, 0xd9, 0xc4, 0xe4, 0x02, 0x15, 0xe5, 0x7a, 0x0b, 0x30, 0xcd,
                0x49, 0x9d, 0x21, 0x33, 0x5c, 0x3a, 0xcf, 0xe7, 0xc9, 0x7c, 0xdc, 0xc9, 0x40, 0x5e,
                0xe3, 0x5f, 0xc4, 0xa7,
            ],
        ),
    );
    let public_3 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x69, 0x1d, 0xdd, 0x92, 0xbd, 0x66, 0x6d, 0x3a, 0x17, 0xfe, 0x16, 0x5b, 0x9e, 0x1c,
                0xd9, 0x25, 0xba, 0xfa, 0x92, 0xe6, 0x22, 0xbe, 0x9f, 0x46, 0xfa, 0xee, 0xbc, 0x95,
                0xb6, 0x5a, 0x8f, 0x5e,
            ],
        ),
    );
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
    );
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
    );
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
    );
    let public_7 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x01,
            ],
        ),
    );

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
            Fr::from_u256(public_7),
        ],
    );

    let pub_signals = PublicSignals {
        pub_signals: output,
    };

    pub_signals.to_bytes(env)
}

fn init_erronous_pub_signals(env: &Env) -> Bytes {
    let public_0 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x41, 0x9e, 0x3d, 0xa0, 0x9a, 0x24, 0xb3, 0x5d, 0x01, 0x4f, 0x50, 0x11, 0xf0, 0xd1,
                0xd5, 0xe4, 0x68, 0xae, 0xb8, 0xe2, 0x8f, 0x57, 0x9d, 0xfe, 0xbf, 0x2f, 0x2e, 0xed,
                0x1c, 0x6e, 0x7a, 0xde,
            ],
        ),
    );
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
    );
    let public_2 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x42, 0xc0, 0x37, 0xe8, 0xd9, 0xc4, 0xe4, 0x02, 0x15, 0xe5, 0x7a, 0x0b, 0x30, 0xcd,
                0x49, 0x9d, 0x21, 0x33, 0x5c, 0x3a, 0xcf, 0xe7, 0xc9, 0x7c, 0xdc, 0xc9, 0x40, 0x5e,
                0xe3, 0x5f, 0xc4, 0xa6,
            ],
        ),
    );
    let public_3 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x69, 0x1d, 0xdd, 0x92, 0xbd, 0x66, 0x6d, 0x3a, 0x17, 0xfe, 0x16, 0x5b, 0x9e, 0x1c,
                0xd9, 0x25, 0xba, 0xfa, 0x92, 0xe6, 0x22, 0xbe, 0x9f, 0x46, 0xfa, 0xee, 0xbc, 0x95,
                0xb6, 0x5a, 0x8f, 0x5e,
            ],
        ),
    );
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
    );
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
    );
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
    );
    let public_7 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x01,
            ],
        ),
    );

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
            Fr::from_u256(public_7),
        ],
    );

    let pub_signals = PublicSignals {
        pub_signals: output,
    };

    pub_signals.to_bytes(env)
}

fn init_deposit_vk(env: &Env) -> Bytes {
    let vk = VerificationKey {
        alpha: g1_from_coords(env, "498096176487216679327361136947535099636681698045067210078959885922834934566608391096040938452749016509772006336337", "2772211886376673709292937008866741277323116873472485433526706121510292956370840145929694541977921631755822954363395"),
        beta: g2_from_coords(env, "3688749396582217800728123824350218306928851687537166143507198041413976840866518788019990782664662680912130460652290", "3738402338172532271069588764590694875160982492775445449824188734757473923242973970365900004370874139638933996196988", "3977909346238777002102548710206455447003993585610055752631747771384033917905292544784757028839990468194866430785581", "306354319493681378568761503382884080258085025375612238548445348594744034427657423782595277482363188725313913404385"),
        gamma: g2_from_coords(env, "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160", "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758", "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905", "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582"),
        delta: g2_from_coords(env, "3461847753750820224178529163587860045536016947963630888694468009133940540493248757369060882518280366751454385748762", "1763773451153600970701787526015454915919553735493690918460004291266385012425848041240058244035841914957177736852310", "2668838301570508544040274238752127856479142633862910584883203738242308001024170937150952093312705273667534990004164", "3387806811949368005426574136610148042702590237111473782847351648664511946734165694040681966420169563080592618064269"),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(env, "2525368387686119133158240838281547028373836612940390706844788786323574093821192975969153997987399651187451475956989", "2859824489237497338564760890570756888954398534644849343144784807094014800809206101014458418039679442004003920617828"),
                g1_from_coords(env, "3895292292918978922222539492042826387092416265198517021685392832861652920546818795250588413967295296288661578918141", "2649126800558856244350478342714736249446244544758518217670691834394702686313258091485854016063249217430098543069756"),
                g1_from_coords(env, "2943134976022779937468233660602552560115841028728370677187115157451850765492367677998261882565225856972878241764920", "3264114213708060323303004359417298450263954690188117902080637546131935471559022463248013478648808840341328239973824"),
            ],
        ),
    };

    vk.to_bytes(env)
}

fn init_deposit_proof(env: &Env) -> Bytes {
    let proof = Proof {
        a: g1_from_coords(env, "737923202379040323781428764732210662661426845485211599080825485013501580088883193115193876548827329147094197201736", "770389758434686650902164848460650488102910675980251091670783739621572399459658035412415679692451604008287614192856"),
        b: g2_from_coords(env, "2410338739714421562030151772847361730719559699089203185195813673387435789200039397412049568846342033447164456421581", "1981126012729579258494097313945885393500529175889317319031248016665406873731298157053085513807677471380714460901494", "911949882454804696012732801760048207761906699061339242904747578686025895493739933512196767093393473955932461729038", "3377882371951109102440598630195459942313660225296154586302084806879389616068625174344205495911888703333440822443088"),
        c: g1_from_coords(env, "377874089757147915511057809980279863136962973928836166174369008705980307753054773466371943738933027902448149789723", "744074742686285060595024777769187396615569064123739153089726674023884612302298711392256015085256265558327460060455"),
    };

    proof.to_bytes(env)
}

fn init_deposit_pub_signals(env: &Env) -> Bytes {
    let public_0 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x70, 0x9f, 0x9c, 0x5a, 0xca, 0x88, 0xef, 0x30, 0x21, 0x82, 0x44, 0x01, 0xe8, 0x4f,
                0xc2, 0xef, 0xaf, 0x06, 0x7c, 0xa1, 0xcc, 0xa6, 0x7a, 0x00, 0x0d, 0x35, 0x89, 0x9b,
                0x4c, 0x4b, 0xd1, 0xc3,
            ],
        ),
    );
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
    );

    let output = Vec::from_array(&env, [Fr::from_u256(public_0), Fr::from_u256(public_1)]);

    let pub_signals = PublicSignals {
        pub_signals: output,
    };

    pub_signals.to_bytes(env)
}

fn init_order_commitments(env: &Env) -> Vec<BytesN<32>> {
    Vec::from_array(
        env,
        [
            BytesN::from_array(
                env,
                &[
                    0x4e, 0xc1, 0xe1, 0x38, 0xc2, 0x91, 0xff, 0x06, 0xbe, 0x8c, 0x96, 0x6a, 0x18, 0x93,
                    0x8a, 0x75, 0x2b, 0x66, 0xf1, 0xa4, 0xcc, 0x08, 0xff, 0x4b, 0x46, 0x8d, 0x66, 0x7a,
                    0x7c, 0x2a, 0x60, 0x39,
                ],
            ),
            BytesN::from_array(
                env,
                &[
                    0x61, 0x91, 0x35, 0x58, 0x30, 0x91, 0xda, 0xc1, 0x05, 0x86, 0x49, 0x24, 0x81, 0x23,
                    0x70, 0x52, 0x43, 0xe5, 0x07, 0x1a, 0xf8, 0x17, 0xcc, 0xcd, 0x39, 0xa6, 0x19, 0x91,
                    0x29, 0x8c, 0x2b, 0x1e,
                ],
            ),
            BytesN::from_array(
                env,
                &[
                    0x54, 0x69, 0xfb, 0x15, 0xbb, 0x0f, 0x0e, 0x87, 0xf4, 0x29, 0xdd, 0x1f, 0x3e, 0x35,
                    0x50, 0xad, 0x69, 0xeb, 0xdd, 0x0f, 0x04, 0x8b, 0x54, 0x4e, 0x7c, 0xad, 0xa2, 0xa4,
                    0x30, 0x90, 0x84, 0x0b,
                ],
            ),
            BytesN::from_array(
                env,
                &[
                    0x13, 0x18, 0xaa, 0xde, 0x5f, 0xbf, 0x09, 0xbb, 0xdb, 0xd5, 0xfd, 0x45, 0x2c, 0x14,
                    0x07, 0x32, 0xfe, 0x2f, 0x36, 0x56, 0x2e, 0xf5, 0x7c, 0xba, 0x1a, 0xf3, 0x8d, 0xd4,
                    0x08, 0x5f, 0x6c, 0xe6,
                ],
            ),
        ],
    )
}

fn init_batch_vk(env: &Env) -> Bytes {
    let vk = VerificationKey {
        alpha: g1_from_coords(env, "498096176487216679327361136947535099636681698045067210078959885922834934566608391096040938452749016509772006336337", "2772211886376673709292937008866741277323116873472485433526706121510292956370840145929694541977921631755822954363395"),
        beta: g2_from_coords(env, "3688749396582217800728123824350218306928851687537166143507198041413976840866518788019990782664662680912130460652290", "3738402338172532271069588764590694875160982492775445449824188734757473923242973970365900004370874139638933996196988", "3977909346238777002102548710206455447003993585610055752631747771384033917905292544784757028839990468194866430785581", "306354319493681378568761503382884080258085025375612238548445348594744034427657423782595277482363188725313913404385"),
        gamma: g2_from_coords(env, "352701069587466618187139116011060144890029952792775240219908644239793785735715026873347600343865175952761926303160", "3059144344244213709971259814753781636986470325476647558659373206291635324768958432433509563104347017837885763365758", "1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905", "927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582"),
        delta: g2_from_coords(env, "1548148996206557342913216095947693900207287287037985228052666806255156246105297261570252371114948104953747198027961", "788361334462515095571871599988556172522678333966518086037653053722007901027845288605664198197911891913824258935430", "26478141723356370895744226698221651809439563736648007683908880520588705128772039080401347721041502578404115697634", "441832085796398197550181710839456708038028747178082557133285290108543009635235474526312664353188136574740155611275"),
        ic: Vec::from_array(
            env,
            [
                g1_from_coords(env, "850636947921663919533848346746830184692762901627368790185341521570674435129282506831766286329981523427538843824772", "1327742088426809311116325248475676316856075288865070722034101108576605974413219097996632161556629411579956358622888"),
                g1_from_coords(env, "2919117701672803084391386244164746385510001857526289884777904988592303301011897728237303123881583013096014704009661", "3318226707499415896428725923781924873336167935880461087711993922022160352134191626937937362721002435983253200020350"),
                g1_from_coords(env, "2890639660178845651948087856466842481303285461939125418572134387371153208507627065655689471554329156103561667549240", "2486026229648392062607501276543248192743520748599213814936062340844864073044844256879782639159808014770233961770283"),
                g1_from_coords(env, "395686256060391972990919014040899173696985829507425592437340092425295377971069457318252766910912315384734762586493", "891835316874719179783401203884814524578874613926121279031867619872095528382589797090153024657822818507672760447976"),
                g1_from_coords(env, "1900025326961590538315524346649698620010028197784356280827526024421766091591008494393486411758770737729829571165544", "1446695698171532772174469609629200429110838907461822765074324648593235323547612452172160396264011093561324419711642"),
                g1_from_coords(env, "3550930596586256381783533347888977099238617132223380464263407077619508938283334823383889384039537507596585720690831", "2748120315015804611249377695093165883895199026995923466299033551524028977484510915058860123943643236541984843978434"),
                g1_from_coords(env, "1363536944560665692803984893356087181391629193482946335401542308843264057497200943336331803386965296093776823843461", "82055020371608456065044472990400947861698315334599743367849409235077158770002388429292803274181680584686815883590"),
                g1_from_coords(env, "2469819472132741364793055296411288724031515610112396824939979416283793569801706658601846722572018838015607346901907", "3399405617951714083710978613611303048272201817270042822946407358280619998882175084934128886606678136255856090663699"),
            ],
        ),
    };

    vk.to_bytes(env)
}

fn init_batch_proof(env: &Env) -> Bytes {
    let proof = Proof {
        a: g1_from_coords(env, "838353351685664239056464767396640902050032743434208944572649683562092317609236565962463702727230089603242822273550", "3732260042940831583569299190465898252384612351106393389295279879642899627842742905263529014404966636432858811611533"),
        b: g2_from_coords(env, "2824094912819246267308242266238680996867072321728315896375179917866879978786967893944335989225413142134957915581374", "2363605256350394526131883942032584081844393539520174539309915922829983540817263890832057174709173205420923311344465", "2514697693587015921369595913624346861270552441182366062196542387138782554205808515311644567824049218245502379777844", "1052540293355231466260900657597721884025229882384863514099124953534503378537531360449793964238874374341868539718697"),
        c: g1_from_coords(env, "2144291601939391703743445488149633805845656066573393763433504790240921976201649175355939161583654245090174630212043", "1661982646816392761714512961342720692623753490748301558769074570121029917994060474069699565052161278424502456311720"),
    };

    proof.to_bytes(env)
}

fn init_batch_pub_signals(env: &Env) -> Bytes {
    let public_0 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x1e,
            ],
        ),
    );
    let public_1 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x14,
            ],
        ),
    );
    let public_2 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x57, 0x8d, 0x34, 0xed, 0x1c, 0xf3, 0x92, 0x7c, 0xc4, 0x85, 0xa7, 0x9d, 0x94, 0xf4,
                0x85, 0x7c, 0xdb, 0x3b, 0x2a, 0x9c, 0xf5, 0xeb, 0x8d, 0x01, 0x15, 0xd4, 0x01, 0xff,
                0xc4, 0xc1, 0x66, 0xe3,
            ],
        ),
    );
    let public_3 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x2a, 0xce, 0x77, 0xef, 0x80, 0x53, 0x7e, 0xd1, 0x33, 0xbd, 0xfd, 0x1c, 0xd4, 0xc8,
                0xab, 0x79, 0x0c, 0x80, 0xc0, 0x9d, 0x08, 0xc3, 0x91, 0x95, 0x14, 0xce, 0xa3, 0xb2,
                0x87, 0x39, 0x98, 0xab,
            ],
        ),
    );
    let public_4 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x59, 0xef, 0x1e, 0x57, 0xa2, 0x35, 0xc5, 0xb5, 0x98, 0x8b, 0x42, 0x25, 0xd0, 0xb3,
                0xd1, 0xee, 0xb1, 0x3c, 0xc0, 0xef, 0x39, 0xe6, 0x3b, 0xb1, 0xed, 0x7e, 0x8c, 0x43,
                0xb3, 0xb3, 0x11, 0xae,
            ],
        ),
    );
    let public_5 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x25, 0x95, 0x52, 0x50, 0x2e, 0x71, 0x72, 0xa0, 0xc8, 0x34, 0xa6, 0x88, 0x16, 0x99,
                0x12, 0xf9, 0x3a, 0x26, 0xbf, 0x5f, 0x98, 0xae, 0x3c, 0xf3, 0xea, 0xa5, 0x3e, 0x50,
                0x49, 0x52, 0x53, 0x02,
            ],
        ),
    );
    let public_6 = U256::from_be_bytes(
        &env,
        &Bytes::from_array(
            &env,
            &[
                0x61, 0xf0, 0x7d, 0x5b, 0x61, 0x51, 0x44, 0x68, 0x90, 0x56, 0xbb, 0x64, 0xf9, 0x87,
                0xe6, 0x4a, 0xce, 0x90, 0x9e, 0xd3, 0x78, 0x7c, 0x80, 0xe9, 0xce, 0x73, 0xf8, 0xa5,
                0x5f, 0xb2, 0xf7, 0x02,
            ],
        ),
    );

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

    pub_signals.to_bytes(env)
}

fn setup_test_environment(env: &Env, outcome: Option<Side>) -> (Address, Address, Address) {
    let token_admin = Address::generate(env);
    let token_id = env.register(MockToken, ());
    let token_client = MockTokenClient::new(env, &token_id);
    token_client.initialize(
        &token_admin,
        &7u32,
        &String::from_str(env, "Test Token"),
        &String::from_str(env, "TEST"),
    );

    let admin = Address::generate(env);
    let market_id = env.register(MockMarket, (outcome,));
    let privacy_pools_id = env.register(
        PrivacyPoolsContract,
        (
            init_vk(env),
            init_deposit_vk(env),
            token_id.clone(),
            admin.clone(),
            market_id,
            1000000000i128,
        ),
    );

    (token_id, privacy_pools_id, admin)
}

#[test]
fn test_deposit_and_withdraw_correct_proof() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::Yes));
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
    client.deposit(&alice, &commitment, &init_deposit_proof(&env), &init_deposit_pub_signals(&env));

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
    let (token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::Yes));
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    let alice = Address::generate(&env);
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);
    client.deposit(&alice, &test_commitment(&env), &init_deposit_proof(&env), &init_deposit_pub_signals(&env));
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
fn test_withdraw_losing_outcome_rejected() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::No));
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    let alice = Address::generate(&env);
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);
    client.deposit(&alice, &test_commitment(&env), &init_deposit_proof(&env), &init_deposit_pub_signals(&env));
    client.set_association_root(&admin, &test_association_root(&env));

    let bob = test_recipient(&env);
    let result = client.withdraw(&bob, &init_proof(&env), &init_pub_signals(&env));
    assert_eq!(
        result,
        vec![&env, String::from_str(&env, ERROR_WRONG_OUTCOME)]
    );

    assert_eq!(token_client.balance(&bob), 0);
    assert_eq!(token_client.balance(&contract_id), 1000000000);
    assert_eq!(client.get_nullifiers().len(), 0);
}

#[test]
fn test_withdraw_unresolved_market_rejected() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env, None);
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    let alice = Address::generate(&env);
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);
    client.deposit(&alice, &test_commitment(&env), &init_deposit_proof(&env), &init_deposit_pub_signals(&env));
    client.set_association_root(&admin, &test_association_root(&env));

    let bob = test_recipient(&env);
    let result = client.withdraw(&bob, &init_proof(&env), &init_pub_signals(&env));
    assert_eq!(
        result,
        vec![&env, String::from_str(&env, ERROR_MARKET_UNRESOLVED)]
    );

    assert_eq!(client.get_nullifiers().len(), 0);
}

#[test]
fn test_deposit_wrong_commitment_rejected() {
    let env = Env::default();
    let (token_id, contract_id, _admin) = setup_test_environment(&env, Some(Side::Yes));
    let client = PrivacyPoolsContractClient::new(&env, &contract_id);
    let token_client = MockTokenClient::new(&env, &token_id);

    let alice = Address::generate(&env);
    env.mock_all_auths();
    token_client.mint(&alice, &1000000000);

    let bad = BytesN::from_array(&env, &[0xaau8; 32]);
    let r = client.try_deposit(
        &alice,
        &bad,
        &init_deposit_proof(&env),
        &init_deposit_pub_signals(&env),
    );
    assert!(r.is_err() || r.unwrap().is_err());
    assert_eq!(client.get_commitment_count(), 0);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn submit_batch_verifies_and_moves_market_odds() {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token_id = env.register(MockToken, ());
    let token_client = MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &token_admin,
        &7u32,
        &String::from_str(&env, "T"),
        &String::from_str(&env, "T"),
    );

    let admin = Address::generate(&env);
    let market_id = env.register(MockMarket, (Some(Side::Yes),));
    let mm = MockMarketClient::new(&env, &market_id);
    mm.set_token(&token_id);

    let pool_id = env.register(
        PrivacyPoolsContract,
        (
            init_vk(&env),
            init_deposit_vk(&env),
            token_id.clone(),
            admin.clone(),
            market_id.clone(),
            1000000000i128,
        ),
    );
    let client = PrivacyPoolsContractClient::new(&env, &pool_id);
    client.set_batch_vk(&admin, &init_batch_vk(&env));

    let trader = Address::generate(&env);
    token_client.mint(&trader, &1000);
    for c in init_order_commitments(&env).iter() {
        client.place_order(&trader, &c, &10);
    }

    let net = client.submit_batch(
        &30,
        &20,
        &init_batch_proof(&env),
        &init_batch_pub_signals(&env),
    );
    assert_eq!(net, 25);
    assert_eq!(mm.get_q(), (30, 20));
    assert_eq!(token_client.balance(&market_id), 25);
    assert_eq!(token_client.balance(&pool_id), 15);
}

#[test]
fn submit_batch_rejects_replay() {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token_id = env.register(MockToken, ());
    let token_client = MockTokenClient::new(&env, &token_id);
    token_client.initialize(
        &token_admin,
        &7u32,
        &String::from_str(&env, "T"),
        &String::from_str(&env, "T"),
    );

    let admin = Address::generate(&env);
    let market_id = env.register(MockMarket, (Some(Side::Yes),));
    let mm = MockMarketClient::new(&env, &market_id);
    mm.set_token(&token_id);

    let pool_id = env.register(
        PrivacyPoolsContract,
        (
            init_vk(&env),
            init_deposit_vk(&env),
            token_id.clone(),
            admin.clone(),
            market_id.clone(),
            1000000000i128,
        ),
    );
    let client = PrivacyPoolsContractClient::new(&env, &pool_id);
    client.set_batch_vk(&admin, &init_batch_vk(&env));

    let trader = Address::generate(&env);
    token_client.mint(&trader, &1000);
    for c in init_order_commitments(&env).iter() {
        client.place_order(&trader, &c, &10);
    }

    client.submit_batch(&30, &20, &init_batch_proof(&env), &init_batch_pub_signals(&env));
    let r = client.try_submit_batch(
        &30,
        &20,
        &init_batch_proof(&env),
        &init_batch_pub_signals(&env),
    );
    assert!(r.is_err() || r.unwrap().is_err());
    assert_eq!(mm.get_q(), (30, 20));
}

#[test]
fn test_deposit_and_withdraw_wrong_proof() {
    let env = Env::default();
    let (token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::Yes));

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
    client.deposit(&alice, &commitment, &init_deposit_proof(&env), &init_deposit_pub_signals(&env));

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
    let (_token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::Yes));
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
    let (token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::Yes));
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
    client.deposit(&alice, &commitment, &init_deposit_proof(&env), &init_deposit_pub_signals(&env));

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
    let (_token_id, contract_id, _admin) = setup_test_environment(&env, Some(Side::Yes));
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
    let (token_id, contract_id, _admin) = setup_test_environment(&env, Some(Side::Yes));

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
    client.deposit(&alice, &commitment, &init_deposit_proof(&env), &init_deposit_pub_signals(&env));

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
    let (token_id, contract_id, admin) = setup_test_environment(&env, Some(Side::Yes));

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
    client.deposit(&alice, &commitment, &init_deposit_proof(&env), &init_deposit_pub_signals(&env));

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
    let (_token_id, contract_id, _admin) = setup_test_environment(&env, Some(Side::Yes));
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
    let (token_id, contract_id, _admin) = setup_test_environment(&env, Some(Side::Yes));

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
    client.deposit(&alice, &commitment, &init_deposit_proof(&env), &init_deposit_pub_signals(&env));

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
